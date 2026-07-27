// scripts/tests/search-files.test.js
// node scripts/tests/search-files.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/fs/glob.js', 'core/tools/search-files.js'];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => makeRootHandle(tree) };
  return root.ClaudefsCore.tools.search_files.handler;
}

async function main() {
  await runTests([
    [
      '"*.txt" 匹配当前目录下的文件（不含子目录）',
      async () => {
        const search = setup({ 'a.txt': 'x', src: { __dir: true, children: { 'b.txt': 'x' } } });
        const result = await search({ path: '.', pattern: '*.txt' });
        const text = result.content[0].text;
        assert.ok(text.includes('a.txt'), text);
        assert.ok(!text.includes('src/b.txt'), text);
      }
    ],
    [
      '"**/*.txt" 既匹配根目录文件也匹配嵌套文件（对齐真实 minimatch 行为）',
      async () => {
        const search = setup({ 'a.txt': 'x', src: { __dir: true, children: { 'b.txt': 'x' } } });
        const result = await search({ path: '.', pattern: '**/*.txt' });
        const text = result.content[0].text;
        assert.ok(text.includes('a.txt'), text);
        assert.ok(text.includes('src/b.txt'), text);
      }
    ],
    [
      '不带通配符的字面量 pattern 必须整段匹配相对路径，不做任意深度兜底',
      async () => {
        const search = setup({ src: { __dir: true, children: { 'foo.txt': 'x' } } });
        const resultLiteral = await search({ path: '.', pattern: 'foo.txt' });
        assert.strictEqual(resultLiteral.content[0].text, 'No matches found');

        const resultWithPrefix = await search({ path: '.', pattern: '**/foo.txt' });
        assert.ok(resultWithPrefix.content[0].text.includes('src/foo.txt'), resultWithPrefix.content[0].text);
      }
    ],
    [
      'excludePatterns 同样是单次锚定匹配，不做任意深度兜底',
      async () => {
        const search = setup({
          src: { __dir: true, children: { 'foo.txt': 'x', nested: { __dir: true, children: { 'foo.txt': 'x' } } } }
        });
        // 字面量 exclude "src/foo.txt" 只精确排除那一个路径，不会连带排除 src/nested/foo.txt
        const result = await search({ path: '.', pattern: '**/foo.txt', excludePatterns: ['src/foo.txt'] });
        const text = result.content[0].text;
        assert.ok(!text.includes('src/foo.txt\n') && !text.endsWith('src/foo.txt'), text);
        assert.ok(text.includes('src/nested/foo.txt'), text);
      }
    ],
    [
      '0 个匹配返回官方一致的字面量 "No matches found"',
      async () => {
        const search = setup({ 'a.txt': 'x' });
        const result = await search({ path: '.', pattern: '*.md' });
        assert.strictEqual(result.content[0].text, 'No matches found');
      }
    ],
    [
      '非根 path 时，返回结果是相对已连接文件夹根目录的路径',
      async () => {
        const search = setup({ src: { __dir: true, children: { 'a.txt': 'x' } } });
        const result = await search({ path: 'src', pattern: '*.txt' });
        assert.ok(result.content[0].text.includes('src/a.txt'), result.content[0].text);
      }
    ],
    [
      '含 WSL 私有区字符的文件名：glob 匹配用原始名（不受转义影响），结果展示时转义成可见序列',
      async () => {
        const realName = `back${String.fromCodePoint(0xf05c)}slash.txt`;
        const search = setup({ [realName]: 'x' });
        const result = await search({ path: '.', pattern: '*.txt' });
        assert.ok(result.content[0].text.includes('back\\uF05Cslash.txt'), result.content[0].text);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
