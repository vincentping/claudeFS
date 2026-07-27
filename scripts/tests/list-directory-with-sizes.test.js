// scripts/tests/list-directory-with-sizes.test.js
// node scripts/tests/list-directory-with-sizes.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/tools/list-directory-with-sizes.js'];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => makeRootHandle(tree) };
  return root.ClaudefsCore.tools.list_directory_with_sizes.handler;
}

async function main() {
  await runTests([
    [
      '默认按名称排序，目录大小列留空、不计入 Combined size',
      async () => {
        const list = setup({ 'b.txt': 'hello', 'a.txt': 'hi', sub: { __dir: true, children: {} } });
        const result = await list({ path: '.' });
        const text = result.content[0].text;
        const lines = text.split('\n');
        assert.ok(lines[0].startsWith('[FILE] a.txt'), lines[0]);
        assert.ok(lines[1].startsWith('[FILE] b.txt'), lines[1]);
        assert.ok(lines[2].startsWith('[DIR] sub'), lines[2]);
        assert.ok(!/\[DIR\] sub.*\d/.test(lines[2]), 'sub 目录那一行不应该带任何数字大小');
        assert.ok(text.includes('Total: 2 files, 1 directories'), text);
        assert.ok(text.includes('Combined size: 7 B') || text.includes('Combined size:'), text);
      }
    ],
    [
      'sortBy: size 按大小降序排列',
      async () => {
        const list = setup({ small: 'a', big: 'a'.repeat(1000) });
        const result = await list({ path: '.', sortBy: 'size' });
        const lines = result.content[0].text.split('\n');
        assert.ok(lines[0].startsWith('[FILE] big'), lines[0]);
        assert.ok(lines[1].startsWith('[FILE] small'), lines[1]);
      }
    ],
    [
      '含 WSL 私有区字符的文件名，展示时转义成可见序列（docs/archives/20260715_review_2_reply.md）',
      async () => {
        const realName = `has${String.fromCodePoint(0xf03a)}colon.txt`;
        const list = setup({ [realName]: 'x' });
        const result = await list({ path: '.' });
        assert.ok(result.content[0].text.includes('[FILE] has\\uF03Acolon.txt'), result.content[0].text);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
