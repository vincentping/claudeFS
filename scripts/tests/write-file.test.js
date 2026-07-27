// scripts/tests/write-file.test.js
// node scripts/tests/write-file.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle, simulateExternalEdit } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = [
  'core/fs/name-escape.js',
  'core/fs/sandbox.js',
  'core/fs/read-tracker.js',
  'core/diff.js',
  'core/tools/write-file.js'
];

function setup(tree, { approve = true } = {}) {
  const root = loadContext(CORE_FILES);
  const rootHandle = makeRootHandle(tree);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
  let lastPayload = null;
  root.ClaudefsCore.confirm = {
    requestConfirmation: async (payload) => {
      lastPayload = payload;
      return { approved: approve };
    }
  };
  return {
    write: root.ClaudefsCore.tools.write_file.handler,
    readTracker: root.ClaudefsCore.fs.readTracker,
    tree,
    getLastPayload: () => lastPayload
  };
}

async function main() {
  await runTests([
    [
      '新建文件：成功写盘，返回成功文本',
      async () => {
        const { write, tree } = setup({});
        const result = await write({ path: 'a.txt', content: 'hello' });
        assert.ok(result.content[0].text.includes('Successfully wrote to a.txt'), result.content[0].text);
        assert.strictEqual(tree['a.txt'].toString(), 'hello');
      }
    ],
    [
      '用户拒绝：文件不变，返回取消文本（不是错误）',
      async () => {
        const { write, tree } = setup({ 'a.txt': 'old' }, { approve: false });
        const result = await write({ path: 'a.txt', content: 'new' });
        assert.ok(result.content[0].text.includes('用户取消'), result.content[0].text);
        assert.strictEqual(tree['a.txt'].toString(), 'old');
      }
    ],
    [
      '写前冲突检测：无基线（从未读过）→ 覆盖写不警示',
      async () => {
        const { write, getLastPayload } = setup({ 'a.txt': 'old' });
        await write({ path: 'a.txt', content: 'new' });
        const payload = getLastPayload();
        assert.strictEqual(payload.warning, undefined, JSON.stringify(payload));
      }
    ],
    [
      '写前冲突检测：读到真实 mtime 后未被外部修改 → 不警示',
      async () => {
        const tree = { 'a.txt': 'old' };
        const root = loadContext(CORE_FILES);
        const rootHandle = makeRootHandle(tree);
        root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
        let lastPayload = null;
        root.ClaudefsCore.confirm = {
          requestConfirmation: async (payload) => {
            lastPayload = payload;
            return { approved: true };
          }
        };
        const fileHandle = await rootHandle.getFileHandle('a.txt');
        const file = await fileHandle.getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        await root.ClaudefsCore.tools.write_file.handler({ path: 'a.txt', content: 'new' });
        assert.strictEqual(lastPayload.warning, undefined, JSON.stringify(lastPayload));
      }
    ],
    [
      '写前冲突检测：读后被外部修改 → 覆盖写警示（不拦截，approved 仍能通过）',
      async () => {
        const tree = { 'a.txt': 'old' };
        const root = loadContext(CORE_FILES);
        const rootHandle = makeRootHandle(tree);
        root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
        let lastPayload = null;
        root.ClaudefsCore.confirm = {
          requestConfirmation: async (payload) => {
            lastPayload = payload;
            return { approved: true };
          }
        };
        const fileHandle = await rootHandle.getFileHandle('a.txt');
        const file = await fileHandle.getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        simulateExternalEdit(tree, 'a.txt', 'changed by someone else');

        const result = await root.ClaudefsCore.tools.write_file.handler({ path: 'a.txt', content: 'new' });
        assert.ok(lastPayload.warning && lastPayload.warning.includes('modified externally'), JSON.stringify(lastPayload));
        assert.ok(result.content[0].text.includes('Successfully wrote'), result.content[0].text);
        assert.strictEqual(tree['a.txt'].toString(), 'new', '警示不拦截，approved 后仍应正常写盘');
      }
    ],
    [
      '写前冲突检测：自己的写不会触发下一次误报',
      async () => {
        const tree = { 'a.txt': 'old' };
        const root = loadContext(CORE_FILES);
        const rootHandle = makeRootHandle(tree);
        root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
        let payloads = [];
        root.ClaudefsCore.confirm = {
          requestConfirmation: async (payload) => {
            payloads.push(payload);
            return { approved: true };
          }
        };
        const fileHandle = await rootHandle.getFileHandle('a.txt');
        const file = await fileHandle.getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);

        await root.ClaudefsCore.tools.write_file.handler({ path: 'a.txt', content: 'first write' });
        await root.ClaudefsCore.tools.write_file.handler({ path: 'a.txt', content: 'second write' });

        assert.strictEqual(payloads[0].warning, undefined, '第一次写：读后未变，不警示');
        assert.strictEqual(payloads[1].warning, undefined, '第二次写：基线已被自己第一次写更新，不应误报');
      }
    ],
    [
      '写前冲突检测：重连（reset）后清空基线，不再警示',
      async () => {
        const tree = { 'a.txt': 'old' };
        const root = loadContext(CORE_FILES);
        const rootHandle = makeRootHandle(tree);
        root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
        let lastPayload = null;
        root.ClaudefsCore.confirm = {
          requestConfirmation: async (payload) => {
            lastPayload = payload;
            return { approved: true };
          }
        };
        const fileHandle = await rootHandle.getFileHandle('a.txt');
        const file = await fileHandle.getFile();
        root.ClaudefsCore.fs.readTracker.recordRead('a.txt', file.lastModified);
        simulateExternalEdit(tree, 'a.txt', 'changed');

        root.ClaudefsCore.fs.readTracker.reset();

        await root.ClaudefsCore.tools.write_file.handler({ path: 'a.txt', content: 'new' });
        assert.strictEqual(lastPayload.warning, undefined, 'reset 后应视为无基线，不警示');
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
