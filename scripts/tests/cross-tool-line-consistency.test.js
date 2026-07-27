// scripts/tests/cross-tool-line-consistency.test.js
// 今天新增的行号一致性铁律的验证：grep_files 报的命中行号、read_file_lines 按行读取的
// 行号、edit_file 报错里的行号、insert_lines 的插入位置，四者必须是同一基准——grep 说第
// N 行有匹配，read_file_lines 读第 N 行必须正是那一行，edit_file 报"多处匹配"时提到的
// 行号也要对得上，insert_lines 在第 N 行后插入也要落在同一条边界上。
//
// 用一个 CRLF 换行、5 行、其中第 3 行和第 5 行都出现 "needle here" 的文件验证一致性。
// node scripts/tests/cross-tool-line-consistency.test.js
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
  'core/diff.js',
  'core/tools/grep-files.js',
  'core/tools/read-file-lines.js',
  'core/tools/edit-file.js',
  'core/tools/insert-lines.js',
  'core/tools/get-file-info.js'
];

// 5 行，CRLF 换行，"needle here" 出现在第 3 行和第 5 行。
const CONTENT =
  'line1: aaa\r\n' + 'line2: bbb\r\n' + 'line3: needle here\r\n' + 'line4: ccc\r\n' + 'line5: needle here\r\n';

function setup() {
  const root = loadContext(CORE_FILES);
  const rootHandle = makeRootHandle({ 'a.txt': CONTENT });
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
  root.ClaudefsCore.diff = { computeLineDiff: () => [], formatDiffText: () => '' };
  root.ClaudefsCore.confirm = {
    requestConfirmation: async () => {
      throw new Error('不应该走到确认弹窗（多处匹配应该在匹配阶段就报错）');
    }
  };
  return root.ClaudefsCore.tools;
}

async function main() {
  await runTests([
    [
      'grep_files 命中的行号 === read_file_lines 按该行号读到的内容 === edit_file 报错提到的行号',
      async () => {
        const tools = setup();

        // 1) grep_files 定位 "needle" 出现的行号。
        const grepResult = await tools.grep_files.handler({ pattern: 'needle' });
        const grepText = grepResult.content[0].text;
        assert.ok(grepText.includes('a.txt:3:'), grepText);
        assert.ok(grepText.includes('a.txt:5:'), grepText);
        assert.ok(!grepText.includes('a.txt:2:') && !grepText.includes('a.txt:4:'), grepText);

        // 2) read_file_lines 用同样的行号（3 和 5）读取，内容必须正是 grep 报告的那一行
        //    （且 CRLF 的 \r 已被去掉）。
        const line3 = await tools.read_file_lines.handler({ path: 'a.txt', start_line: 3, end_line: 3 });
        assert.ok(line3.content[0].text.startsWith('3: line3: needle here'), line3.content[0].text);
        const line5 = await tools.read_file_lines.handler({ path: 'a.txt', start_line: 5, end_line: 5 });
        assert.ok(line5.content[0].text.startsWith('5: line5: needle here'), line5.content[0].text);

        // 3) edit_file 用一个在两行都出现的 oldText（"needle here"），触发"多处匹配"报错，
        //    报错里提到的行号必须同样是 3 和 5——证明三个工具共用同一套行号基准。
        let threw = false;
        try {
          await tools.edit_file.handler({
            path: 'a.txt',
            edits: [{ oldText: 'needle here', newText: 'replaced' }]
          });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('3') && err.message.includes('5'), err.message);
        }
        assert.ok(threw, 'oldText 命中两处应该报错（edit_file 的既有安全规则）');
      }
    ],
    [
      'insert_lines 在 grep_files/read_file_lines 认定的行号之后插入，落点与三者一致',
      async () => {
        const root = loadContext(CORE_FILES);
        const rootHandle = makeRootHandle({ 'a.txt': CONTENT });
        root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
        root.ClaudefsCore.confirm = { requestConfirmation: async () => ({ approved: true }) };
        const tools = root.ClaudefsCore.tools;

        // grep_files 确认第 3 行是命中行；insert_lines 在第 3 行后插入，应该正好插在
        // "line3: needle here" 和 "line4: ccc" 之间——与 grep/read_file_lines 认定的
        // 行边界完全一致，不多不少。
        const grepResult = await tools.grep_files.handler({ pattern: 'needle' });
        assert.ok(grepResult.content[0].text.includes('a.txt:3:'));

        await tools.insert_lines.handler({ path: 'a.txt', after_line: 3, content: 'INSERTED' });
        const around = await tools.read_file_lines.handler({ path: 'a.txt', start_line: 3, end_line: 5 });
        const text = around.content[0].text;
        assert.ok(text.includes('3: line3: needle here'), text);
        assert.ok(text.includes('4: INSERTED'), text);
        assert.ok(text.includes('5: line4: ccc'), text);
      }
    ],
    [
      'get_file_info 的 totalLines === read_file_lines 用 end_line 探到的总行数',
      async () => {
        const root = loadContext(CORE_FILES);
        const rootHandle = makeRootHandle({ 'a.txt': CONTENT });
        root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
        const tools = root.ClaudefsCore.tools;

        // CONTENT 每行都以 "\r\n" 结尾（含最后一行），按 "\n" 计数共 6 段（末尾多一个空
        // 字符串）——这正是"\n" 计数基准的真实行为，不是 5，用 read_file_lines 的越界探测
        // 得到的真实总行数来定义"正确答案"，而不是凭直觉猜一个数。
        const probe = await tools.read_file_lines.handler({ path: 'a.txt', start_line: 1, end_line: 999 });
        assert.ok(probe.content[0].text.includes('文件共 6 行'), probe.content[0].text);

        const info = await tools.get_file_info.handler({ path: 'a.txt' });
        assert.ok(info.content[0].text.includes('totalLines: 6'), info.content[0].text);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
