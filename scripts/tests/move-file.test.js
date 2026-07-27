// scripts/tests/move-file.test.js
// node scripts/tests/move-file.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle, simulateExternalEdit } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/fs/read-tracker.js', 'core/fs/limits.js', 'core/tools/move-file.js'];

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
    move: root.ClaudefsCore.tools.move_file.handler,
    tree,
    root,
    getConfirmCalled: () => confirmCalled,
    getLastPayload: () => lastPayload
  };
}

async function main() {
  await runTests([
    [
      '用户批准：先写新位置成功、再删除源文件，返回成功文本',
      async () => {
        const { move, tree, getLastPayload } = setup({ 'a.txt': 'hello' }, { approve: true });
        const result = await move({ source: 'a.txt', destination: 'b.txt' });
        assert.ok(result.content[0].text.includes('Successfully moved a.txt to b.txt'), result.content[0].text);
        assert.strictEqual(tree['a.txt'], undefined, '源文件应该被删除');
        assert.strictEqual(tree['b.txt'].toString(), 'hello');
        const payload = getLastPayload();
        assert.ok(payload.fullContent.includes('移动: a.txt → b.txt'), JSON.stringify(payload));
      }
    ],
    [
      '用户拒绝：文件不变，返回取消文本（不是错误）',
      async () => {
        const { move, tree } = setup({ 'a.txt': 'hello' }, { approve: false });
        const result = await move({ source: 'a.txt', destination: 'b.txt' });
        assert.ok(result.content[0].text.includes('用户取消'), result.content[0].text);
        assert.strictEqual(tree['a.txt'].toString(), 'hello', '源文件应该原样保留');
        assert.strictEqual(tree['b.txt'], undefined, '目标不应该被创建');
      }
    ],
    [
      '目标已存在：报错，且不会弹确认框（应该在只读检查阶段就拒绝）',
      async () => {
        const { move } = setup({ 'a.txt': 'hello', 'b.txt': 'existing' }, { expectNoConfirm: true });
        let threw = false;
        try {
          await move({ source: 'a.txt', destination: 'b.txt' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('目标已存在'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '源是目录：报错，不支持移动目录',
      async () => {
        const { move } = setup({ src: { __dir: true, children: {} } }, { expectNoConfirm: true });
        let threw = false;
        try {
          await move({ source: 'src', destination: 'dst' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('不支持移动目录'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '源文件超过大小上限：报错，不弹确认框',
      async () => {
        const big = Buffer.alloc(5 * 1024 * 1024 + 1, 'a');
        const { move } = setup({ 'big.txt': big }, { expectNoConfirm: true });
        let threw = false;
        try {
          await move({ source: 'big.txt', destination: 'moved.txt' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('太大'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      'source/destination 缺失时报错',
      async () => {
        const { move } = setup({}, { expectNoConfirm: true });
        let threw = false;
        try {
          await move({ source: '', destination: '' });
        } catch (err) {
          threw = true;
        }
        assert.ok(threw);
      }
    ],
    [
      '写前冲突检测：无基线不警示',
      async () => {
        const { move, getLastPayload } = setup({ 'a.txt': 'hello' });
        await move({ source: 'a.txt', destination: 'b.txt' });
        assert.strictEqual(getLastPayload().warning, undefined, '无基线不应警示');
      }
    ],
    [
      '写前冲突检测：读后未变不警示',
      async () => {
        const { move, root, getLastPayload } = setup({ 'a.txt': 'hello' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        await move({ source: 'a.txt', destination: 'b.txt' });
        assert.strictEqual(getLastPayload().warning, undefined, '读后未变不应警示');
      }
    ],
    [
      '写前冲突检测：源文件读后被外部修改 → 警示（不拦截，approved 后仍正常移动）',
      async () => {
        const { move, tree, root, getLastPayload } = setup({ 'a.txt': 'hello' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        simulateExternalEdit(tree, 'a.txt', 'changed externally');
        await move({ source: 'a.txt', destination: 'b.txt' });

        assert.ok(getLastPayload().warning && getLastPayload().warning.includes('modified externally'), JSON.stringify(getLastPayload()));
        assert.strictEqual(tree['b.txt'].toString(), 'changed externally', '警示不拦截，应移动外部修改后的最新内容');
      }
    ],
    [
      '写前冲突检测：重连（reset）后清空基线，不再警示',
      async () => {
        const { move, tree, root, getLastPayload } = setup({ 'a.txt': 'hello' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();
        const file = await (await rootHandle.getFileHandle('a.txt')).getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);
        simulateExternalEdit(tree, 'a.txt', 'changed');

        root.ClaudefsCore.fs.readTracker.reset();

        await move({ source: 'a.txt', destination: 'b.txt' });
        assert.strictEqual(getLastPayload().warning, undefined, 'reset 后应视为无基线，不警示');
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
