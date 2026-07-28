// scripts/tests/replace-lines.test.js
// node scripts/tests/replace-lines.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle, simulateExternalEdit } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/fs/read-tracker.js', 'core/fs/limits.js', 'core/diff.js', 'core/tools/replace-lines.js'];

function setup(tree, { approve = true, expectNoConfirm = false } = {}) {
  const root = loadContext(CORE_FILES);
  const rootHandle = makeRootHandle(tree);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
  let confirmCalled = false;
  let lastPayload = null;
  root.ClaudefsCore.confirm = {
    requestConfirmation: async (payload) => {
      confirmCalled = true;
      lastPayload = payload;
      if (expectNoConfirm) throw new Error('不应该走到确认弹窗');
      return { approved: approve };
    }
  };
  return {
    replace: root.ClaudefsCore.tools.replace_lines.handler,
    tree,
    root,
    getConfirmCalled: () => confirmCalled,
    getLastPayload: () => lastPayload
  };
}

async function main() {
  await runTests([
    [
      '基本区间替换：1 基行号、含头含尾，多行替换成单行',
      async () => {
        const { replace, tree } = setup({ 'a.txt': 'line1\nline2\nline3\nline4\nline5' }, { approve: true });
        const result = await replace({ path: 'a.txt', start_line: 2, end_line: 4, new_content: 'NEW' });
        assert.strictEqual(tree['a.txt'].toString(), 'line1\nNEW\nline5');
        assert.ok(result.content[0].text.includes('Successfully replaced lines 2-4'), result.content[0].text);
        assert.ok(result.content[0].text.includes('共 3 行'), result.content[0].text);
      }
    ],
    [
      'new_content 为空字符串：等价于删除这几行',
      async () => {
        const { replace, tree } = setup({ 'a.txt': 'line1\nline2\nline3\nline4' }, { approve: true });
        await replace({ path: 'a.txt', start_line: 2, end_line: 3, new_content: '' });
        assert.strictEqual(tree['a.txt'].toString(), 'line1\nline4');
      }
    ],
    [
      'new_content 可以是多行内容（用 \\n 分隔展开成多行）',
      async () => {
        const { replace, tree } = setup({ 'a.txt': 'line1\nline2\nline3' }, { approve: true });
        await replace({ path: 'a.txt', start_line: 2, end_line: 2, new_content: 'x\ny\nz' });
        assert.strictEqual(tree['a.txt'].toString(), 'line1\nx\ny\nz\nline3');
      }
    ],
    [
      '用户拒绝：文件不变，返回取消文本（不是错误）',
      async () => {
        const { replace, tree } = setup({ 'a.txt': 'line1\nline2\nline3' }, { approve: false });
        const result = await replace({ path: 'a.txt', start_line: 2, end_line: 2, new_content: 'X' });
        assert.ok(result.content[0].text.includes('用户取消'), result.content[0].text);
        assert.strictEqual(tree['a.txt'].toString(), 'line1\nline2\nline3', '文件应该原样保留');
      }
    ],
    [
      '确认框展示第 X-Y 行 旧→新内容',
      async () => {
        const { replace, getLastPayload } = setup({ 'a.txt': 'line1\nline2\nline3' }, { approve: true });
        await replace({ path: 'a.txt', start_line: 2, end_line: 2, new_content: 'NEW' });
        const payload = getLastPayload();
        assert.ok(payload.title.includes('Replace lines 2-2'), JSON.stringify(payload));
        assert.ok(payload.fullContent.includes('2: line2'), JSON.stringify(payload));
        assert.ok(payload.fullContent.includes('NEW'), JSON.stringify(payload));
      }
    ],
    [
      'start_line 超过总行数报错，且附"文件共 N 行"，不弹确认框',
      async () => {
        const { replace } = setup({ 'a.txt': 'line1\nline2\nline3' }, { expectNoConfirm: true });
        let threw = false;
        try {
          await replace({ path: 'a.txt', start_line: 10, end_line: 12, new_content: 'X' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('文件共 3 行'), err.message);
        }
        assert.ok(threw, 'start_line 越界应该报错');
      }
    ],
    [
      'end_line 超过总行数不报错，自动截到文件尾并说明',
      async () => {
        const { replace, tree } = setup({ 'a.txt': 'line1\nline2\nline3' }, { approve: true });
        const result = await replace({ path: 'a.txt', start_line: 2, end_line: 100, new_content: 'X' });
        assert.strictEqual(tree['a.txt'].toString(), 'line1\nX');
        assert.ok(result.content[0].text.includes('已截到文件尾'), result.content[0].text);
        assert.ok(result.content[0].text.includes('文件共 3 行'), result.content[0].text);
      }
    ],
    [
      'start_line 必须是 >=1 的整数',
      async () => {
        const { replace } = setup({ 'a.txt': 'a\nb' }, { expectNoConfirm: true });
        let threw = false;
        try {
          await replace({ path: 'a.txt', start_line: 0, end_line: 1, new_content: 'X' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('start_line'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      'end_line 不能小于 start_line',
      async () => {
        const { replace } = setup({ 'a.txt': 'a\nb\nc' }, { expectNoConfirm: true });
        let threw = false;
        try {
          await replace({ path: 'a.txt', start_line: 3, end_line: 1, new_content: 'X' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('end_line'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '文件太大：报错，不弹确认框',
      async () => {
        const big = Buffer.alloc(5 * 1024 * 1024 + 1, 'a');
        const { replace } = setup({ 'big.txt': big }, { expectNoConfirm: true });
        let threw = false;
        try {
          await replace({ path: 'big.txt', start_line: 1, end_line: 1, new_content: 'X' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('太大'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      'CRLF 换行：确认框展示的旧内容不带 \\r',
      async () => {
        const { replace, getLastPayload } = setup({ 'a.txt': 'line1\r\nline2\r\nline3\r\n' }, { approve: true });
        await replace({ path: 'a.txt', start_line: 2, end_line: 2, new_content: 'X' });
        const payload = getLastPayload();
        assert.ok(payload.fullContent.includes('2: line2'), payload.fullContent);
        assert.ok(!payload.fullContent.includes('line2\r'), payload.fullContent);
      }
    ],
    [
      '行号基准按 "\\n" 计数，与 read_file_lines 一致（跨行替换整段重写）',
      async () => {
        const { replace, tree } = setup(
          { 'a.txt': 'a\nb\nc\nd\ne' },
          { approve: true }
        );
        await replace({ path: 'a.txt', start_line: 1, end_line: 5, new_content: 'ALL_NEW' });
        assert.strictEqual(tree['a.txt'].toString(), 'ALL_NEW');
      }
    ],
    [
      '写前冲突检测：无基线不警示',
      async () => {
        const { replace, getLastPayload } = setup({ 'a.txt': 'line1\nline2\nline3' });
        await replace({ path: 'a.txt', start_line: 1, end_line: 1, new_content: 'X' });
        assert.strictEqual(getLastPayload().warning, undefined, '无基线不应警示');
      }
    ],
    [
      '写前冲突检测：读后未变不警示',
      async () => {
        const { replace, root, getLastPayload } = setup({ 'a.txt': 'line1\nline2\nline3' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        await replace({ path: 'a.txt', start_line: 2, end_line: 2, new_content: 'X' });
        assert.strictEqual(getLastPayload().warning, undefined, '读后未变不应警示');
      }
    ],
    [
      '写前冲突检测：读后被外部修改 → 警示（不拦截，approved 后仍正常写盘）',
      async () => {
        const { replace, tree, root, getLastPayload } = setup({ 'a.txt': 'line1\nline2\nline3' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        simulateExternalEdit(tree, 'a.txt', 'line1\nEXTERNAL\nline3');
        await replace({ path: 'a.txt', start_line: 1, end_line: 1, new_content: 'X' });

        assert.ok(getLastPayload().warning && getLastPayload().warning.includes('modified externally'), JSON.stringify(getLastPayload()));
        assert.ok(tree['a.txt'].toString().startsWith('X'), '警示不拦截，approved 后仍应正常写盘');
      }
    ],
    [
      '写前冲突检测：自己的写不会触发下一次误报',
      async () => {
        const { replace, root, getLastPayload } = setup({ 'a.txt': 'line1\nline2\nline3' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        await replace({ path: 'a.txt', start_line: 1, end_line: 1, new_content: 'X1' });
        assert.strictEqual(getLastPayload().warning, undefined, '第一次写：读后未变，不警示');
        await replace({ path: 'a.txt', start_line: 1, end_line: 1, new_content: 'X2' });
        assert.strictEqual(getLastPayload().warning, undefined, '第二次写：基线已被自己第一次写更新，不应误报');
      }
    ],
    [
      '写前冲突检测：重连（reset）后清空基线，不再警示',
      async () => {
        const { replace, tree, root, getLastPayload } = setup({ 'a.txt': 'line1\nline2\nline3' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);
        simulateExternalEdit(tree, 'a.txt', 'line1\nEXTERNAL\nline3');

        root.ClaudefsCore.fs.readTracker.reset();

        await replace({ path: 'a.txt', start_line: 1, end_line: 1, new_content: 'X' });
        assert.strictEqual(getLastPayload().warning, undefined, 'reset 后应视为无基线，不警示');
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
