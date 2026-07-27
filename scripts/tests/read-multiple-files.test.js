// scripts/tests/read-multiple-files.test.js
// node scripts/tests/read-multiple-files.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = [
  'core/fs/name-escape.js', 'core/fs/sandbox.js',
  'core/fs/glob.js',
  'core/fs/binary-detect.js',
  'core/fs/default-excludes.js',
  'core/fs/limits.js',
  'core/fs/read-tracker.js',
  'core/tools/read-multiple-files.js'
];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => makeRootHandle(tree) };
  return root.ClaudefsCore.tools.read_multiple_files.handler;
}

async function main() {
  await runTests([
    [
      '多个有效文件都能正确读取，用 "\\n---\\n" 分隔',
      async () => {
        const read = setup({ 'a.txt': 'hello', 'b.txt': 'world' });
        const result = await read({ paths: ['a.txt', 'b.txt'] });
        const text = result.content[0].text;
        const parts = text.split('\n---\n');
        assert.strictEqual(parts.length, 2);
        assert.ok(parts[0].includes('a.txt:\nhello'), parts[0]);
        assert.ok(parts[1].includes('b.txt:\nworld'), parts[1]);
      }
    ],
    [
      '某个路径不存在，只影响它自己那一段，不影响其它文件',
      async () => {
        const read = setup({ 'a.txt': 'hello' });
        const result = await read({ paths: ['a.txt', 'missing.txt'] });
        const text = result.content[0].text;
        const parts = text.split('\n---\n');
        assert.ok(parts[0].includes('hello'), parts[0]);
        assert.ok(parts[1].startsWith('missing.txt: Error -'), parts[1]);
      }
    ],
    [
      '二进制文件在对应段落里报错，不影响其它文件',
      async () => {
        const read = setup({ 'a.txt': 'hello', 'image.png': 'binary-ish' });
        const result = await read({ paths: ['a.txt', 'image.png'] });
        const parts = result.content[0].text.split('\n---\n');
        assert.ok(parts[0].includes('hello'), parts[0]);
        assert.ok(parts[1].startsWith('image.png: Error -') && parts[1].includes('二进制'), parts[1]);
      }
    ],
    [
      '超过大小上限的文件在对应段落里报错，不影响其它文件',
      async () => {
        const big = Buffer.alloc(5 * 1024 * 1024 + 1, 'a');
        const read = setup({ 'a.txt': 'hello', 'big.txt': big });
        const result = await read({ paths: ['a.txt', 'big.txt'] });
        const parts = result.content[0].text.split('\n---\n');
        assert.ok(parts[0].includes('hello'), parts[0]);
        assert.ok(parts[1].startsWith('big.txt: Error -') && parts[1].includes('太大'), parts[1]);
      }
    ],
    [
      'paths 为空数组时报错',
      async () => {
        const read = setup({ 'a.txt': 'hello' });
        let threw = false;
        try {
          await read({ paths: [] });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('paths'), err.message);
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
