// scripts/tests/read-file-lines.test.js
// node scripts/tests/read-file-lines.test.js
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
  'core/tools/read-file-lines.js'
];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => makeRootHandle(tree) };
  return root.ClaudefsCore.tools.read_file_lines.handler;
}

async function main() {
  await runTests([
    [
      '基本区间读取：1 基行号、含头含尾',
      async () => {
        const read = setup({ 'a.txt': 'line1\nline2\nline3\nline4\nline5' });
        const result = await read({ path: 'a.txt', start_line: 2, end_line: 4 });
        const text = result.content[0].text;
        assert.ok(text.includes('2: line2'), text);
        assert.ok(text.includes('3: line3'), text);
        assert.ok(text.includes('4: line4'), text);
        assert.ok(!text.includes('line1'), text);
        assert.ok(!text.includes('5: line5'), text);
      }
    ],
    [
      'start_line 超过总行数报错，且附"文件共 N 行"',
      async () => {
        const read = setup({ 'a.txt': 'line1\nline2\nline3' });
        let threw = false;
        try {
          await read({ path: 'a.txt', start_line: 10, end_line: 12 });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('文件共 3 行'), err.message);
        }
        assert.ok(threw, 'start_line 越界应该报错');
      }
    ],
    [
      'end_line 超过总行数不报错，自动截到文件尾并说明',
      async () => {
        const read = setup({ 'a.txt': 'line1\nline2\nline3' });
        const result = await read({ path: 'a.txt', start_line: 2, end_line: 100 });
        const text = result.content[0].text;
        assert.ok(text.includes('2: line2'), text);
        assert.ok(text.includes('3: line3'), text);
        assert.ok(text.includes('已截到文件尾'), text);
        assert.ok(text.includes('文件共 3 行'), text);
      }
    ],
    [
      'CRLF 换行：行内容不带 \\r，行号计数不受影响',
      async () => {
        const read = setup({ 'a.txt': 'line1\r\nline2\r\nline3\r\n' });
        const result = await read({ path: 'a.txt', start_line: 2, end_line: 2 });
        const text = result.content[0].text;
        assert.ok(text.startsWith('2: line2'), text);
        assert.ok(!text.includes('\r'), '展示内容不应包含 \\r');
      }
    ],
    [
      'start_line 必须是 >=1 的整数',
      async () => {
        const read = setup({ 'a.txt': 'a\nb' });
        let threw = false;
        try {
          await read({ path: 'a.txt', start_line: 0, end_line: 1 });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('start_line'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      'end_line 不能小于 start_line',
      async () => {
        const read = setup({ 'a.txt': 'a\nb\nc' });
        let threw = false;
        try {
          await read({ path: 'a.txt', start_line: 3, end_line: 1 });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('end_line'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '二进制文件被拒绝并报错',
      async () => {
        const read = setup({ 'image.png': 'line1\nline2' });
        let threw = false;
        try {
          await read({ path: 'image.png', start_line: 1, end_line: 1 });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('二进制'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '单行文件（无换行符）也能正确读取第 1 行',
      async () => {
        const read = setup({ 'a.txt': 'only one line' });
        const result = await read({ path: 'a.txt', start_line: 1, end_line: 1 });
        assert.ok(result.content[0].text.includes('1: only one line'), result.content[0].text);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
