// scripts/tests/delete-file.test.js
// node scripts/tests/delete-file.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle, simulateExternalEdit } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/fs/read-tracker.js', 'core/tools/delete-file.js'];

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
    del: root.ClaudefsCore.tools.delete_file.handler,
    tree,
    root,
    getConfirmCalled: () => confirmCalled,
    getLastPayload: () => lastPayload
  };
}

async function main() {
  await runTests([
    [
      '用户批准：文件被删除，确认框展示文件名+大小，返回成功文本',
      async () => {
        const { del, tree, getLastPayload } = setup({ 'a.txt': 'hello' }, { approve: true });
        const result = await del({ path: 'a.txt' });
        assert.ok(result.content[0].text.includes('Successfully deleted a.txt'), result.content[0].text);
        assert.strictEqual(tree['a.txt'], undefined, '文件应该被删除');
        const payload = getLastPayload();
        assert.ok(payload.fullContent.includes('Will delete: a.txt'), JSON.stringify(payload));
        assert.ok(payload.fullContent.includes('5 bytes'), JSON.stringify(payload));
      }
    ],
    [
      '用户拒绝：文件不变，返回取消文本（不是错误）',
      async () => {
        const { del, tree } = setup({ 'a.txt': 'hello' }, { approve: false });
        const result = await del({ path: 'a.txt' });
        assert.ok(result.content[0].text.includes('用户取消'), result.content[0].text);
        assert.strictEqual(tree['a.txt'].toString(), 'hello', '文件应该原样保留');
      }
    ],
    [
      '目标是目录：报错，且不弹确认框',
      async () => {
        const { del } = setup({ src: { __dir: true, children: {} } }, { expectNoConfirm: true });
        let threw = false;
        try {
          await del({ path: 'src' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('只能删除文件'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '目标不存在：报错，且不弹确认框',
      async () => {
        const { del } = setup({}, { expectNoConfirm: true });
        let threw = false;
        try {
          await del({ path: 'missing.txt' });
        } catch (err) {
          threw = true;
        }
        assert.ok(threw);
      }
    ],
    [
      'path 缺失时报错',
      async () => {
        const { del } = setup({}, { expectNoConfirm: true });
        let threw = false;
        try {
          await del({ path: '' });
        } catch (err) {
          threw = true;
        }
        assert.ok(threw);
      }
    ],
    [
      '写前冲突检测：无基线不警示',
      async () => {
        const { del, getLastPayload } = setup({ 'a.txt': 'hello' });
        await del({ path: 'a.txt' });
        assert.strictEqual(getLastPayload().warning, undefined, '无基线不应警示');
      }
    ],
    [
      '写前冲突检测：读后被外部修改 → 警示（不拦截，approved 后仍正常删除）',
      async () => {
        const { del, tree, root, getLastPayload } = setup({ 'a.txt': 'hello' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        simulateExternalEdit(tree, 'a.txt', 'changed externally');
        await del({ path: 'a.txt' });

        assert.ok(getLastPayload().warning && getLastPayload().warning.includes('modified externally'), JSON.stringify(getLastPayload()));
        assert.strictEqual(tree['a.txt'], undefined, '警示不拦截，approved 后仍应正常删除');
      }
    ],
    [
      '写前冲突检测：重连（reset）后清空基线，不再警示',
      async () => {
        const { del, tree, root, getLastPayload } = setup({ 'a.txt': 'hello' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);
        simulateExternalEdit(tree, 'a.txt', 'changed');

        root.ClaudefsCore.fs.readTracker.reset();

        await del({ path: 'a.txt' });
        assert.strictEqual(getLastPayload().warning, undefined, 'reset 后应视为无基线，不警示');
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
