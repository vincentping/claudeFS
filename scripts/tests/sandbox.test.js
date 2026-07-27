// scripts/tests/sandbox.test.js
// node scripts/tests/sandbox.test.js
// 覆盖 docs/archives/20260715_review_2.md / _reply.md 涉及的 splitPath 边界：
//   - "\uF0XX" 转义序列在解析前还原成真实 WSL 私有使用区字符（问题一、二统一根因的修复）
//   - Windows 风格路径（用 "\" 当分隔符）与 POSIX 风格路径（用 "/" 当分隔符）都继续工作
//   - 反斜杠出现在文件名字面各种位置（开头/中间/结尾/连续多个）时，只要不是我们的转义
//     序列格式，splitPath 现有的 "\\ → /" 分隔符归一化行为不变（未采纳 review 提的
//     "\ 只当字面量" 方案——查证后发现反斜杠丢失的根因不是这个歧义，见 reply 文档）
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js'];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  const rootHandle = makeRootHandle(tree);
  return { sandbox: root.ClaudefsCore.fs.sandbox, rootHandle };
}

const BACKSLASH_PUA = String.fromCodePoint(0xf05c); // WSL 私有区编码的真实反斜杠字符
const COLON_PUA = String.fromCodePoint(0xf03a); // WSL 私有区编码的真实冒号字符

async function main() {
  await runTests([
    [
      '"\\uF05C" 转义序列在 resolveFile 里被还原成真实私有区反斜杠字符，能找到对应文件',
      async () => {
        const realName = `back${BACKSLASH_PUA}slash.txt`;
        const { sandbox, rootHandle } = setup({ [realName]: 'hello' });
        const handle = await sandbox.resolveFile(rootHandle, 'back\\uF05Cslash.txt');
        const file = await handle.getFile();
        assert.strictEqual(await file.text(), 'hello');
      }
    ],
    [
      '"\\uF03A" 转义序列同样能还原并找到含私有区冒号的文件（Zone.Identifier 场景）',
      async () => {
        const realName = `TODO.md${COLON_PUA}Zone.Identifier`;
        const { sandbox, rootHandle } = setup({ [realName]: 'zone data' });
        const handle = await sandbox.resolveFile(rootHandle, 'TODO.md\\uF03AZone.Identifier');
        const file = await handle.getFile();
        assert.strictEqual(await file.text(), 'zone data');
      }
    ],
    [
      '小写十六进制转义（"\\uf05c"）同样能识别并还原',
      async () => {
        const realName = `back${BACKSLASH_PUA}slash.txt`;
        const { sandbox, rootHandle } = setup({ [realName]: 'hello' });
        const handle = await sandbox.resolveFile(rootHandle, 'back\\uf05cslash.txt');
        const file = await handle.getFile();
        assert.strictEqual(await file.text(), 'hello');
      }
    ],
    [
      '还原转义序列不影响多级子目录解析（转义字符出现在中间目录段）',
      async () => {
        const realDirName = `dir${BACKSLASH_PUA}name`;
        const { sandbox, rootHandle } = setup({
          [realDirName]: { __dir: true, children: { 'child.txt': 'nested' } }
        });
        const handle = await sandbox.resolveFile(rootHandle, 'dir\\uF05Cname/child.txt');
        const file = await handle.getFile();
        assert.strictEqual(await file.text(), 'nested');
      }
    ],
    [
      'Windows 风格路径：真实 ASCII 反斜杠（非转义序列、非私有区字符）依然被当作路径分隔符',
      async () => {
        const { sandbox, rootHandle } = setup({
          parent: { __dir: true, children: { child: { __dir: true, children: { 'grandchild.txt': 'win-style' } } } }
        });
        const handle = await sandbox.resolveFile(rootHandle, 'parent\\child\\grandchild.txt');
        const file = await handle.getFile();
        assert.strictEqual(await file.text(), 'win-style');
      }
    ],
    [
      'POSIX 风格路径：正斜杠分隔符继续正常工作（两种风格并存，不因本次改动而互相影响）',
      async () => {
        const { sandbox, rootHandle } = setup({
          parent: { __dir: true, children: { child: { __dir: true, children: { 'grandchild.txt': 'posix-style' } } } }
        });
        const handle = await sandbox.resolveFile(rootHandle, 'parent/child/grandchild.txt');
        const file = await handle.getFile();
        assert.strictEqual(await file.text(), 'posix-style');
      }
    ],
    [
      '真实 ASCII 反斜杠出现在文件名中间/结尾（非私有区、非转义序列）：现有行为不变，依然会被当分隔符切开（未采纳"\\ 只当字面量"方案，见 reply）',
      async () => {
        const { sandbox, rootHandle } = setup({ 'literal.txt': 'x' });
        let threw = false;
        try {
          await sandbox.resolveFile(rootHandle, 'literal.txt\\');
        } catch (err) {
          threw = true;
        }
        // "literal.txt\" 会被 splitPath 切成 ['literal.txt']（末尾反斜杠被当分隔符丢弃后
        // 只剩一个有效 segment），这和改动前的行为一致——不因本次改动而改变真实反斜杠的
        // 语义，只新增了对转义序列的识别。这里断言至少不抛"路径越界"之类的异常。
        assert.ok(!threw, '不应该因为末尾反斜杠而报错');
      }
    ],
    [
      '不属于私有使用区范围的 "\\uXXXX" 字面文本（如 "\\u0041"）不会被 unescape 误还原成任何字符——' +
        '该反斜杠仍然只受现有的"\\ 当分隔符"逻辑处理，不受本次新增的 unescape 影响',
      async () => {
        // "u0041.txt" 前面的 "\" 依然会被既有逻辑当分隔符切开（现有行为，未采纳 review 提的
        // "\ 只当字面量"方案，见 reply）；这里验证的是 unescape 本身只认 F0 开头的私有区
        // 范围，不会把 "A" 这种不在范围内的序列还原成任何字符——所以 "u0041.txt"
        // 段名原样保留，不会变成别的字符。
        const { sandbox, rootHandle } = setup({
          note: { __dir: true, children: { 'u0041end.txt': 'literal' } }
        });
        const handle = await sandbox.resolveFile(rootHandle, 'note\\u0041end.txt');
        const file = await handle.getFile();
        assert.strictEqual(await file.text(), 'literal');
      }
    ],
    [
      '绝对路径依然被拒绝（不受本次改动影响）',
      async () => {
        const { sandbox, rootHandle } = setup({});
        let threw = false;
        try {
          await sandbox.resolveFile(rootHandle, '/etc/passwd');
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('不允许绝对路径'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '".." 越界依然被拒绝（不受本次改动影响，即便还原后的私有区字符路径也一样受这条校验）',
      async () => {
        const { sandbox, rootHandle } = setup({});
        let threw = false;
        try {
          await sandbox.resolveFile(rootHandle, '../secret.txt');
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('越界'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      'resolveEntry 对含私有区字符的目录也能正确识别 kind: directory',
      async () => {
        const realDirName = `weird${COLON_PUA}dir`;
        const { sandbox, rootHandle } = setup({ [realDirName]: { __dir: true, children: {} } });
        const entry = await sandbox.resolveEntry(rootHandle, 'weird\\uF03Adir');
        assert.strictEqual(entry.kind, 'directory');
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
