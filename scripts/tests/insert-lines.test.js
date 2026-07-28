// scripts/tests/insert-lines.test.js
// node scripts/tests/insert-lines.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle, simulateExternalEdit } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = [
  'core/fs/name-escape.js',
  'core/fs/sandbox.js',
  'core/fs/read-tracker.js',
  'core/fs/limits.js',
  'core/diff.js',
  'core/tools/insert-lines.js'
];

function setup(tree, { approve = true, expectNoConfirm = false } = {}) {
  const root = loadContext(CORE_FILES);
  const rootHandle = makeRootHandle(tree);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
  let lastPayload = null;
  root.ClaudefsCore.confirm = {
    requestConfirmation: async (payload) => {
      lastPayload = payload;
      if (expectNoConfirm) throw new Error('不应该走到确认弹窗');
      return { approved: approve };
    }
  };
  return {
    insert: root.ClaudefsCore.tools.insert_lines.handler,
    tree,
    root,
    getLastPayload: () => lastPayload
  };
}

async function main() {
  await runTests([
    [
      'after_line = 0：插到文件最前',
      async () => {
        const { insert, tree } = setup({ 'a.txt': 'line1\nline2' });
        await insert({ path: 'a.txt', after_line: 0, content: 'NEW' });
        assert.strictEqual(tree['a.txt'].toString(), 'NEW\nline1\nline2');
      }
    ],
    [
      'after_line = N：插到第 N 行之后（中间插入）',
      async () => {
        const { insert, tree } = setup({ 'a.txt': 'line1\nline2\nline3' });
        await insert({ path: 'a.txt', after_line: 1, content: 'NEW' });
        assert.strictEqual(tree['a.txt'].toString(), 'line1\nNEW\nline2\nline3');
      }
    ],
    [
      'after_line = 总行数：插到文件末尾',
      async () => {
        const { insert, tree } = setup({ 'a.txt': 'line1\nline2' });
        await insert({ path: 'a.txt', after_line: 2, content: 'NEW' });
        assert.strictEqual(tree['a.txt'].toString(), 'line1\nline2\nNEW');
      }
    ],
    [
      'content 可以是多行内容（用 \\n 分隔展开成多行）',
      async () => {
        const { insert, tree } = setup({ 'a.txt': 'line1\nline2' });
        await insert({ path: 'a.txt', after_line: 1, content: 'x\ny\nz' });
        assert.strictEqual(tree['a.txt'].toString(), 'line1\nx\ny\nz\nline2');
      }
    ],
    [
      '不删除/替换任何既有行：原有内容全部保留（纯插入语义）',
      async () => {
        const { insert, tree } = setup({ 'a.txt': 'a\nb\nc' });
        await insert({ path: 'a.txt', after_line: 2, content: 'X' });
        const linesAfter = tree['a.txt'].toString().split('\n');
        assert.ok(linesAfter.includes('a') && linesAfter.includes('b') && linesAfter.includes('c'));
      }
    ],
    [
      'after_line 超过总行数：报错并附"文件共 N 行"，不弹确认框',
      async () => {
        const { insert } = setup({ 'a.txt': 'line1\nline2' }, { expectNoConfirm: true });
        let threw = false;
        try {
          await insert({ path: 'a.txt', after_line: 10, content: 'X' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('文件共 2 行'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      'after_line 必须是 >= 0 的整数',
      async () => {
        const { insert } = setup({ 'a.txt': 'a\nb' }, { expectNoConfirm: true });
        let threw = false;
        try {
          await insert({ path: 'a.txt', after_line: -1, content: 'X' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('after_line'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '用户拒绝：文件不变，返回取消文本（不是错误）',
      async () => {
        const { insert, tree } = setup({ 'a.txt': 'a\nb' }, { approve: false });
        const result = await insert({ path: 'a.txt', after_line: 1, content: 'X' });
        assert.ok(result.content[0].text.includes('用户取消'), result.content[0].text);
        assert.strictEqual(tree['a.txt'].toString(), 'a\nb');
      }
    ],
    [
      '文件太大：报错，不弹确认框',
      async () => {
        const big = Buffer.alloc(5 * 1024 * 1024 + 1, 'a');
        const { insert } = setup({ 'big.txt': big }, { expectNoConfirm: true });
        let threw = false;
        try {
          await insert({ path: 'big.txt', after_line: 0, content: 'X' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('太大'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '标题：after_line=0 时为"Insert at start of file"，否则为"Insert after line N"',
      async () => {
        const { insert, getLastPayload } = setup({ 'a.txt': 'a\nb' });
        await insert({ path: 'a.txt', after_line: 0, content: 'X' });
        assert.ok(getLastPayload().title.includes('Insert at start of file'), JSON.stringify(getLastPayload()));

        const { insert: insert2, getLastPayload: getLastPayload2 } = setup({ 'a.txt': 'a\nb' });
        await insert2({ path: 'a.txt', after_line: 1, content: 'X' });
        assert.ok(getLastPayload2().title.includes('Insert after line 1'), JSON.stringify(getLastPayload2()));
      }
    ],
    [
      '返回结果包含插入后的新总行数',
      async () => {
        const { insert } = setup({ 'a.txt': 'a\nb' });
        const result = await insert({ path: 'a.txt', after_line: 1, content: 'x\ny' });
        assert.ok(result.content[0].text.includes('共 4 行'), result.content[0].text);
      }
    ],
    [
      '写前冲突检测：无基线不警示',
      async () => {
        const { insert, getLastPayload } = setup({ 'a.txt': 'a\nb' });
        await insert({ path: 'a.txt', after_line: 1, content: 'X' });
        assert.strictEqual(getLastPayload().warning, undefined);
      }
    ],
    [
      '写前冲突检测：读后被外部修改 → 警示（不拦截，approved 后仍正常插入）',
      async () => {
        const { insert, tree, root, getLastPayload } = setup({ 'a.txt': 'a\nb\nc' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        simulateExternalEdit(tree, 'a.txt', 'a\nEXTERNAL\nb\nc');
        await insert({ path: 'a.txt', after_line: 1, content: 'X' });

        assert.ok(getLastPayload().warning && getLastPayload().warning.includes('modified externally'), JSON.stringify(getLastPayload()));
        assert.strictEqual(tree['a.txt'].toString(), 'a\nX\nEXTERNAL\nb\nc');
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
