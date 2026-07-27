// scripts/tests/directory-tree.test.js
// node scripts/tests/directory-tree.test.js
// 覆盖转义修复：directory_tree 的 name 字段展示前
// 转义 WSL 私有区字符，但 glob 排除匹配和递归遍历必须用原始未转义的 name，否则子目录的
// excludePatterns 会拿转义后的假路径去匹配、永远匹配不上。
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = [
  'core/fs/name-escape.js',
  'core/fs/sandbox.js',
  'core/fs/glob.js',
  'core/tools/directory-tree.js'
];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => makeRootHandle(tree) };
  return root.ClaudefsCore.tools.directory_tree.handler;
}

const BACKSLASH_PUA = String.fromCodePoint(0xf05c);

async function main() {
  await runTests([
    [
      '普通目录树正常输出（no-op，基本功能不受影响）',
      async () => {
        const tree = setup({ 'a.txt': 'x', src: { __dir: true, children: { 'b.txt': 'x' } } });
        const result = await tree({ path: '.' });
        const parsed = JSON.parse(result.content[0].text);
        const names = parsed.map((n) => n.name);
        assert.ok(names.includes('a.txt'));
        assert.ok(names.includes('src'));
      }
    ],
    [
      '含 WSL 私有区反斜杠的文件名，JSON 里的 name 字段展示时转义成可见序列',
      async () => {
        const realName = `back${BACKSLASH_PUA}slash.txt`;
        const tree = setup({ [realName]: 'x' });
        const result = await tree({ path: '.' });
        const parsed = JSON.parse(result.content[0].text);
        assert.strictEqual(parsed[0].name, 'back\\uF05Cslash.txt');
      }
    ],
    [
      '含私有区字符的子目录内部递归正常展开（转义只发生在展示字段，不影响遍历本身）',
      async () => {
        const realDirName = `weird${BACKSLASH_PUA}dir`;
        const tree = setup({
          [realDirName]: { __dir: true, children: { 'inner.txt': 'x' } }
        });
        const result = await tree({ path: '.' });
        const parsed = JSON.parse(result.content[0].text);
        assert.strictEqual(parsed[0].name, 'weird\\uF05Cdir');
        assert.strictEqual(parsed[0].type, 'directory');
        assert.strictEqual(parsed[0].children.length, 1);
        assert.strictEqual(parsed[0].children[0].name, 'inner.txt');
      }
    ],
    [
      'excludePatterns 排除依然基于原始（未转义）路径生效，不受展示层转义影响',
      async () => {
        // node_modules 是默认忽略目录之一；这里验证默认排除逻辑在有私有区字符文件混入
        // 同一层级时依然正常工作（排除判断用的是原始 name，不会因为兄弟文件含私有区
        // 字符而被打乱）。
        const realName = `back${BACKSLASH_PUA}slash.txt`;
        const tree = setup({
          [realName]: 'x',
          node_modules: { __dir: true, children: { 'pkg.js': 'x' } }
        });
        const result = await tree({ path: '.' });
        const parsed = JSON.parse(result.content[0].text);
        const names = parsed.map((n) => n.name);
        assert.ok(names.includes('back\\uF05Cslash.txt'));
        assert.ok(!names.includes('node_modules'));
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
