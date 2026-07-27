// scripts/tests/rm-empty-dir.test.js
// node scripts/tests/rm-empty-dir.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/tools/rm-empty-dir.js'];

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
    rm: root.ClaudefsCore.tools.rm_empty_dir.handler,
    tree,
    getConfirmCalled: () => confirmCalled,
    getLastPayload: () => lastPayload
  };
}

async function main() {
  await runTests([
    [
      '用户批准：空目录被删除，确认框展示目录名，返回成功文本',
      async () => {
        const { rm, tree, getLastPayload } = setup(
          { empty: { __dir: true, children: {} } },
          { approve: true }
        );
        const result = await rm({ path: 'empty' });
        assert.ok(
          result.content[0].text.includes('Successfully removed empty directory empty'),
          result.content[0].text
        );
        assert.strictEqual(tree.empty, undefined, '空目录应该被删除');
        const payload = getLastPayload();
        assert.ok(payload.fullContent.includes('将删除空目录：empty'), JSON.stringify(payload));
      }
    ],
    [
      '用户拒绝：目录不变，返回取消文本（不是错误）',
      async () => {
        const { rm, tree } = setup({ empty: { __dir: true, children: {} } }, { approve: false });
        const result = await rm({ path: 'empty' });
        assert.ok(result.content[0].text.includes('用户取消'), result.content[0].text);
        assert.ok(tree.empty && tree.empty.__dir, '目录应该原样保留');
      }
    ],
    [
      '非空目录：报错拒绝，附条目数，绝不弹确认框、绝不删除',
      async () => {
        const { rm, tree } = setup(
          { full: { __dir: true, children: { 'a.txt': 'x', 'b.txt': 'y' } } },
          { expectNoConfirm: true }
        );
        let threw = false;
        try {
          await rm({ path: 'full' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('非空'), err.message);
          assert.ok(err.message.includes('2 个条目'), err.message);
          assert.ok(err.message.includes('绝不递归删除'), err.message);
        }
        assert.ok(threw, '非空目录应该报错');
        assert.ok(tree.full && tree.full.__dir, '非空目录不应该被删除');
        assert.strictEqual(Object.keys(tree.full.children).length, 2, '非空目录内容应该原样保留');
      }
    ],
    [
      '目标是文件：报错，不弹确认框',
      async () => {
        const { rm } = setup({ 'a.txt': 'hello' }, { expectNoConfirm: true });
        let threw = false;
        try {
          await rm({ path: 'a.txt' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('只能删除目录'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '目标不存在：报错，不弹确认框',
      async () => {
        const { rm } = setup({}, { expectNoConfirm: true });
        let threw = false;
        try {
          await rm({ path: 'missing' });
        } catch (err) {
          threw = true;
        }
        assert.ok(threw);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
