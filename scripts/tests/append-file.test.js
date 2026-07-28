// scripts/tests/append-file.test.js
// node scripts/tests/append-file.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle, simulateExternalEdit } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = [
  'core/fs/name-escape.js',
  'core/fs/sandbox.js',
  'core/fs/read-tracker.js',
  'core/tools/append-file.js'
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
    append: root.ClaudefsCore.tools.append_file.handler,
    tree,
    root,
    getLastPayload: () => lastPayload
  };
}

async function main() {
  await runTests([
    [
      '文件已存在：内容追加到末尾，不影响已有内容',
      async () => {
        const { append, tree } = setup({ 'a.txt': 'line1\n' });
        const result = await append({ path: 'a.txt', content: 'line2\n' });
        assert.strictEqual(tree['a.txt'].toString(), 'line1\nline2\n');
        assert.ok(result.content[0].text.includes('Successfully appended'), result.content[0].text);
      }
    ],
    [
      '文件不存在：等价于新建（对齐 shell ">>" 语义），返回文案说明是新建',
      async () => {
        const { append, tree } = setup({});
        const result = await append({ path: 'new.txt', content: 'hello' });
        assert.strictEqual(tree['new.txt'].toString(), 'hello');
        assert.ok(result.content[0].text.includes('Successfully created'), result.content[0].text);
      }
    ],
    [
      '不自动补换行：content 原样追加，紧贴在已有内容之后',
      async () => {
        const { append, tree } = setup({ 'a.txt': 'abc' });
        await append({ path: 'a.txt', content: 'def' });
        assert.strictEqual(tree['a.txt'].toString(), 'abcdef');
      }
    ],
    [
      '确认框只展示追加内容，不展示全文 diff；新建时标题标注"New file (append)"',
      async () => {
        const { append, getLastPayload } = setup({});
        await append({ path: 'new.txt', content: 'hello' });
        const payload = getLastPayload();
        assert.ok(payload.title.includes('New file (append)'), JSON.stringify(payload));
        assert.strictEqual(payload.fullContent, 'hello', JSON.stringify(payload));
        assert.strictEqual(payload.diffLines, undefined, '不应该有全文 diff');
      }
    ],
    [
      '已存在文件的确认框标题为"Append to file"',
      async () => {
        const { append, getLastPayload } = setup({ 'a.txt': 'abc' });
        await append({ path: 'a.txt', content: 'def' });
        assert.ok(getLastPayload().title.includes('Append to file'), JSON.stringify(getLastPayload()));
      }
    ],
    [
      '用户拒绝：文件不变，返回取消文本（不是错误）',
      async () => {
        const { append, tree } = setup({ 'a.txt': 'abc' }, { approve: false });
        const result = await append({ path: 'a.txt', content: 'def' });
        assert.ok(result.content[0].text.includes('用户取消'), result.content[0].text);
        assert.strictEqual(tree['a.txt'].toString(), 'abc');
      }
    ],
    [
      '写前冲突检测：无基线不警示',
      async () => {
        const { append, getLastPayload } = setup({ 'a.txt': 'abc' });
        await append({ path: 'a.txt', content: 'def' });
        assert.strictEqual(getLastPayload().warning, undefined);
      }
    ],
    [
      '写前冲突检测：读后被外部修改 → 警示（不拦截，approved 后仍正常追加）',
      async () => {
        const { append, tree, root, getLastPayload } = setup({ 'a.txt': 'abc' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        simulateExternalEdit(tree, 'a.txt', 'changed-externally');
        await append({ path: 'a.txt', content: 'def' });

        assert.ok(getLastPayload().warning && getLastPayload().warning.includes('modified externally'), JSON.stringify(getLastPayload()));
        // 定位写用的是"重新读到的 existingSize"（外部改动后的最新大小），追加应紧贴在
        // 外部改动后的最新内容之后，而不是基于陈旧的旧内容。
        assert.strictEqual(tree['a.txt'].toString(), 'changed-externallydef');
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
