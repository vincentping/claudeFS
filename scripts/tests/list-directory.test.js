// scripts/tests/list-directory.test.js
// node scripts/tests/list-directory.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/tools/list-directory.js'];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  const rootHandle = makeRootHandle(tree);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
  return root.ClaudefsCore.tools.list_directory.handler;
}

const BACKSLASH_PUA = String.fromCodePoint(0xf05c);
const COLON_PUA = String.fromCodePoint(0xf03a);

async function main() {
  await runTests([
    [
      '返回 {content, structuredContent} 形状，与官方契约一致，structuredContent.content 与 content[0].text 一致',
      async () => {
        const list = setup({ 'a.txt': 'x' });
        const result = await list({ path: '.' });
        assert.ok(Array.isArray(result.content), JSON.stringify(result));
        assert.strictEqual(result.content[0].type, 'text');
        assert.strictEqual(result.structuredContent.content, result.content[0].text);
      }
    ],
    [
      '普通文件名原样列出（no-op，不受转义逻辑影响）',
      async () => {
        const list = setup({ 'a.txt': 'x', sub: { __dir: true, children: {} } });
        const result = await list({ path: '.' });
        const text = result.content[0].text;
        assert.ok(text.includes('[FILE] a.txt'), text);
        assert.ok(text.includes('[DIR] sub'), text);
      }
    ],
    [
      '含 WSL 私有区反斜杠的文件名，展示时转义成可见的 "\\uF0XX" 序列',
      async () => {
        const realName = `back${BACKSLASH_PUA}slash.txt`;
        const list = setup({ [realName]: 'x' });
        const result = await list({ path: '.' });
        const text = result.content[0].text;
        assert.ok(text.includes('[FILE] back\\uF05Cslash.txt'), text);
      }
    ],
    [
      '含 WSL 私有区冒号的文件名（Zone.Identifier 场景），展示时转义成可见序列',
      async () => {
        const realName = `TODO.md${COLON_PUA}Zone.Identifier`;
        const list = setup({ [realName]: 'x' });
        const result = await list({ path: '.' });
        const text = result.content[0].text;
        assert.ok(text.includes('[FILE] TODO.md\\uF03AZone.Identifier'), text);
      }
    ],
    [
      '展示名可以原样复制回 path 参数，工具能定位到同一个真实文件（往返一致）',
      async () => {
        const realName = `has${COLON_PUA}colon.txt`;
        const list = setup({ [realName]: 'zone content' });
        const result = await list({ path: '.' });
        const listing = result.content[0].text;
        const displayLine = listing.split('\n').find((l) => l.startsWith('[FILE]'));
        const displayName = displayLine.replace('[FILE] ', '');
        assert.strictEqual(displayName, 'has\\uF03Acolon.txt');

        // 模拟 Claude 把 list_directory 看到的展示名原样传回另一个工具（这里直接验证
        // sandbox 能不能凭这个展示名重新解析回同一个真实文件）。
        const root = loadContext(CORE_FILES);
        const rootHandle = makeRootHandle({ [realName]: 'zone content' });
        const handle = await root.ClaudefsCore.fs.sandbox.resolveFile(rootHandle, displayName);
        const file = await handle.getFile();
        assert.strictEqual(await file.text(), 'zone content');
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
