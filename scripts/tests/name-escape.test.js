// scripts/tests/name-escape.test.js
// node scripts/tests/name-escape.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { runTests } = require('./helpers/mini-test');

function setup() {
  const root = loadContext(['core/fs/name-escape.js']);
  return root.ClaudefsCore.fs.nameEscape;
}

async function main() {
  await runTests([
    [
      'escapeSpecialChars: 私有使用区字符（反斜杠 U+F05C）转成可见 "\\uF0XX" 序列',
      async () => {
        const { escapeSpecialChars } = setup();
        const name = `back${String.fromCodePoint(0xf05c)}slash.txt`;
        assert.strictEqual(escapeSpecialChars(name), 'back\\uF05Cslash.txt');
      }
    ],
    [
      'escapeSpecialChars: 私有使用区字符（冒号 U+F03A）转成可见 "\\uF0XX" 序列',
      async () => {
        const { escapeSpecialChars } = setup();
        const name = `has${String.fromCodePoint(0xf03a)}colon.txt`;
        assert.strictEqual(escapeSpecialChars(name), 'has\\uF03Acolon.txt');
      }
    ],
    [
      'escapeSpecialChars: 普通文件名（无私有区字符）原样不变（no-op）',
      async () => {
        const { escapeSpecialChars } = setup();
        assert.strictEqual(escapeSpecialChars('普通文件名😀.txt'), '普通文件名😀.txt');
        assert.strictEqual(escapeSpecialChars(''), '');
      }
    ],
    [
      'escapeSpecialChars: 私有使用区范围之外的字符（如 U+E000）不转义',
      async () => {
        const { escapeSpecialChars } = setup();
        const name = `x${String.fromCodePoint(0xe000)}y.txt`;
        assert.strictEqual(escapeSpecialChars(name), name);
      }
    ],
    [
      'unescapeSpecialChars: "\\uF0XX" 序列还原成真实私有使用区字符',
      async () => {
        const { unescapeSpecialChars } = setup();
        const restored = unescapeSpecialChars('back\\uF05Cslash.txt');
        assert.strictEqual(restored, `back${String.fromCodePoint(0xf05c)}slash.txt`);
      }
    ],
    [
      'unescapeSpecialChars: 小写十六进制（\\uf05c）同样能识别',
      async () => {
        const { unescapeSpecialChars } = setup();
        const restored = unescapeSpecialChars('back\\uf05cslash.txt');
        assert.strictEqual(restored, `back${String.fromCodePoint(0xf05c)}slash.txt`);
      }
    ],
    [
      'unescapeSpecialChars: 不在 F0 范围内的 "\\uXXXX" 字面文本不受影响（如 \\u0041）',
      async () => {
        const { unescapeSpecialChars } = setup();
        assert.strictEqual(unescapeSpecialChars('foo\\u0041bar'), 'foo\\u0041bar');
      }
    ],
    [
      'escape → unescape 往返一致（round-trip）',
      async () => {
        const { escapeSpecialChars, unescapeSpecialChars } = setup();
        const original = `TODO.md${String.fromCodePoint(0xf03a)}Zone.Identifier`;
        const roundTripped = unescapeSpecialChars(escapeSpecialChars(original));
        assert.strictEqual(roundTripped, original);
      }
    ],
    [
      '同一字符串中含多个私有区字符都能各自转义/还原',
      async () => {
        const { escapeSpecialChars, unescapeSpecialChars } = setup();
        const original = `${String.fromCodePoint(0xf05c)}a${String.fromCodePoint(0xf03a)}b`;
        const escaped = escapeSpecialChars(original);
        assert.strictEqual(escaped, '\\uF05Ca\\uF03Ab');
        assert.strictEqual(unescapeSpecialChars(escaped), original);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
