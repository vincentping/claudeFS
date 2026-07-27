// scripts/tests/get-file-info.test.js
// node scripts/tests/get-file-info.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/fs/binary-detect.js', 'core/fs/limits.js', 'core/tools/get-file-info.js'];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => makeRootHandle(tree) };
  return root.ClaudefsCore.tools.get_file_info.handler;
}

async function main() {
  await runTests([
    [
      '文件：size/modified 是真实值，created/accessed/permissions 是说明文字',
      async () => {
        const info = setup({ 'a.txt': 'hello' });
        const result = await info({ path: 'a.txt' });
        const text = result.content[0].text;
        assert.ok(text.includes('size: 5'), text);
        assert.ok(text.includes('isDirectory: false'), text);
        assert.ok(text.includes('isFile: true'), text);
        assert.ok(text.includes('created: 不可用'), text);
        assert.ok(text.includes('accessed: 不可用'), text);
        assert.ok(text.includes('permissions: 不可用'), text);
        assert.ok(/modified: \d{4}-\d{2}-\d{2}T/.test(text), text);
      }
    ],
    [
      '目录：所有字段都是说明文字（浏览器 API 无法提供），isDirectory/isFile 正确',
      async () => {
        const info = setup({ sub: { __dir: true, children: {} } });
        const result = await info({ path: 'sub' });
        const text = result.content[0].text;
        assert.ok(text.includes('isDirectory: true'), text);
        assert.ok(text.includes('isFile: false'), text);
        assert.ok(text.includes('size: 不可用'), text);
        assert.ok(text.includes('modified: 不可用'), text);
        assert.ok(text.includes('totalLines: 目录无行数'), text);
      }
    ],
    [
      'totalLines：文本文件按 "\\n" 计数，n 个换行符对应 n+1 行',
      async () => {
        const info = setup({ 'a.txt': 'line1\nline2\nline3' }); // 2 个换行符，3 行
        const result = await info({ path: 'a.txt' });
        assert.ok(result.content[0].text.includes('totalLines: 3'), result.content[0].text);
      }
    ],
    [
      'totalLines：空文件算 1 行（与 "".split("\\n").length 语义一致）',
      async () => {
        const info = setup({ 'empty.txt': '' });
        const result = await info({ path: 'empty.txt' });
        assert.ok(result.content[0].text.includes('totalLines: 1'), result.content[0].text);
      }
    ],
    [
      'totalLines：二进制文件不统计行数',
      async () => {
        const info = setup({ 'a.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
        const result = await info({ path: 'a.png' });
        assert.ok(result.content[0].text.includes('totalLines: 二进制文件不统计行数'), result.content[0].text);
      }
    ],
    [
      'totalLines：超过 5MB 的文件不统计',
      async () => {
        const big = Buffer.alloc(5 * 1024 * 1024 + 1, 'a');
        const info = setup({ 'big.txt': big });
        const result = await info({ path: 'big.txt' });
        assert.ok(result.content[0].text.includes('totalLines: 文件过大未统计'), result.content[0].text);
      }
    ],
    [
      '不存在的路径报错',
      async () => {
        const info = setup({});
        let threw = false;
        try {
          await info({ path: 'nope.txt' });
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
