// scripts/tests/dispatch.test.js
// node scripts/tests/dispatch.test.js
// 覆盖 core/dispatch.js 的 unlisted 过滤：read_file 已 deprecated，
// 不再出现在 listTools()，但 callTool('read_file', ...) 仍必须可用（不报"未知工具"）。
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = [
  'core/fs/name-escape.js',
  'core/fs/sandbox.js',
  'core/fs/binary-detect.js',
  'core/fs/limits.js',
  'core/fs/read-tracker.js',
  'core/tools/read-file.js',
  'core/dispatch.js'
];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => makeRootHandle(tree) };
  return root.ClaudefsCore.dispatch;
}

async function main() {
  await runTests([
    [
      'listTools() 不包含 read_file（unlisted），但仍包含 read_text_file',
      async () => {
        const dispatch = setup({ 'a.txt': 'hello' });
        const names = dispatch.listTools().map((t) => t.name);
        assert.ok(!names.includes('read_file'), names.join(','));
        assert.ok(names.includes('read_text_file'), names.join(','));
      }
    ],
    [
      "callTool('read_file', ...) 仍可正常调用（不报未知工具，行为与 read_text_file 一致）",
      async () => {
        const dispatch = setup({ 'a.txt': 'hello' });
        const result = await dispatch.callTool('read_file', { path: 'a.txt' });
        assert.strictEqual(result.structuredContent.content, 'hello');
      }
    ]
  ]);
}

main();
