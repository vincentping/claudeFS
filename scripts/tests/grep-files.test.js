// scripts/tests/grep-files.test.js
// node scripts/tests/grep-files.test.js
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
  'core/tools/grep-files.js'
];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => makeRootHandle(tree) };
  return root.ClaudefsCore.tools.grep_files.handler;
}

async function main() {
  await runTests([
    [
      '字面量匹配：找到正确的文件路径/行号/行内容',
      async () => {
        const grep = setup({ 'a.txt': 'line1\nneedle here\nline3' });
        const result = await grep({ pattern: 'needle' });
        assert.ok(result.content[0].text.includes('a.txt:2: needle here'), result.content[0].text);
      }
    ],
    [
      'case_sensitive 默认 true：大小写不同不命中',
      async () => {
        const grep = setup({ 'a.txt': 'Needle here' });
        const result = await grep({ pattern: 'needle' });
        assert.ok(result.content[0].text.includes('未找到匹配'), result.content[0].text);
      }
    ],
    [
      'case_sensitive:false 时忽略大小写',
      async () => {
        const grep = setup({ 'a.txt': 'Needle here' });
        const result = await grep({ pattern: 'needle', case_sensitive: false });
        assert.ok(result.content[0].text.includes('a.txt:1:'), result.content[0].text);
      }
    ],
    [
      'regex:true 按正则解释',
      async () => {
        const grep = setup({ 'a.txt': 'foo123bar' });
        const result = await grep({ pattern: '\\d+', regex: true });
        assert.ok(result.content[0].text.includes('a.txt:1:'), result.content[0].text);
      }
    ],
    [
      'regex 无效时报清晰错误',
      async () => {
        const grep = setup({ 'a.txt': 'foo' });
        let threw = false;
        try {
          await grep({ pattern: '(', regex: true });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('正则表达式无效'), err.message);
        }
        assert.ok(threw, '无效正则应该报错');
      }
    ],
    [
      '0 命中返回明确的"未找到匹配"说明，不是空字符串',
      async () => {
        const grep = setup({ 'a.txt': 'hello world' });
        const result = await grep({ pattern: 'nonexistent-pattern' });
        const text = result.content[0].text;
        assert.notStrictEqual(text, '');
        assert.ok(text.includes('未找到匹配'), text);
      }
    ],
    [
      '结果数超过上限时明确告知"已截断"，不静默丢弃',
      async () => {
        const lines = [];
        for (let i = 0; i < 250; i++) lines.push('needle');
        const grep = setup({ 'big.txt': lines.join('\n') });
        const result = await grep({ pattern: 'needle' });
        const text = result.content[0].text;
        assert.ok(text.includes('已截断'), text);
        assert.ok(text.includes('至少找到 200 处'), text);
        const resultLineCount = text.split('\n').filter((l) => l.startsWith('big.txt:')).length;
        assert.strictEqual(resultLineCount, 200, `应恰好返回 200 条结果，实际 ${resultLineCount}`);
      }
    ],
    [
      '二进制文件（按扩展名）被跳过，且在返回文本里提示跳过数量',
      async () => {
        const grep = setup({ 'image.png': 'needle inside binary-looking file', 'ok.txt': 'needle here' });
        const result = await grep({ pattern: 'needle' });
        const text = result.content[0].text;
        assert.ok(!text.includes('image.png'), text);
        assert.ok(text.includes('ok.txt:1:'), text);
        assert.ok(text.includes('跳过了 1 个二进制文件'), text);
      }
    ],
    [
      '二进制文件（按 NUL 字节嗅探）也会被跳过',
      async () => {
        const withNul = Buffer.concat([Buffer.from('needle '), Buffer.from([0x00]), Buffer.from('rest')]);
        const grep = setup({ 'weird.dat': withNul });
        const result = await grep({ pattern: 'needle' });
        assert.ok(result.content[0].text.includes('未找到匹配'), result.content[0].text);
      }
    ],
    [
      '默认忽略 node_modules、.git',
      async () => {
        const grep = setup({
          node_modules: { __dir: true, children: { 'dep.js': 'needle' } },
          '.git': { __dir: true, children: { HEAD: 'needle' } },
          'src.js': 'needle'
        });
        const result = await grep({ pattern: 'needle' });
        const text = result.content[0].text;
        assert.ok(!text.includes('node_modules'), text);
        assert.ok(!text.includes('.git'), text);
        assert.ok(text.includes('src.js:1:'), text);
      }
    ],
    [
      'glob 过滤：只在匹配 glob 的文件里搜索',
      async () => {
        const grep = setup({ 'a.md': 'needle', 'b.txt': 'needle' });
        const result = await grep({ pattern: 'needle', glob: '*.md' });
        const text = result.content[0].text;
        assert.ok(text.includes('a.md:1:'), text);
        assert.ok(!text.includes('b.txt'), text);
      }
    ],
    [
      'glob "*.md"（不含斜杠）按 basename 任意深度匹配，命中根目录和子目录的 .md（P1a 修正）',
      async () => {
        const grep = setup({
          'root.md': 'needle',
          docs: { __dir: true, children: { 'design-notes.md': 'needle', 'nested': { __dir: true, children: { 'deep.md': 'needle' } } } },
          'b.txt': 'needle'
        });
        const result = await grep({ pattern: 'needle', glob: '*.md' });
        const text = result.content[0].text;
        assert.ok(text.includes('root.md:1:'), text);
        assert.ok(text.includes('docs/design-notes.md:1:'), text);
        assert.ok(text.includes('docs/nested/deep.md:1:'), text);
        assert.ok(!text.includes('b.txt'), text);
      }
    ],
    [
      'glob "src/*.js"（含斜杠）按路径锚定到 src 这一层，不命中更深的子目录（P1a 修正）',
      async () => {
        const grep = setup({
          src: {
            __dir: true,
            children: {
              'a.js': 'needle',
              nested: { __dir: true, children: { 'b.js': 'needle' } }
            }
          },
          'c.js': 'needle'
        });
        const result = await grep({ pattern: 'needle', glob: 'src/*.js' });
        const text = result.content[0].text;
        assert.ok(text.includes('src/a.js:1:'), text);
        assert.ok(!text.includes('src/nested/b.js'), text);
        assert.ok(!text.includes(' c.js'), text);
      }
    ],
    [
      'glob "**/*.md"（显式含斜杠的任意深度写法）依然能命中根目录和子目录（和隐式 "*.md" 效果一致）',
      async () => {
        const grep = setup({
          'root.md': 'needle',
          docs: { __dir: true, children: { 'design-notes.md': 'needle' } }
        });
        const result = await grep({ pattern: 'needle', glob: '**/*.md' });
        const text = result.content[0].text;
        assert.ok(text.includes('root.md:1:'), text);
        assert.ok(text.includes('docs/design-notes.md:1:'), text);
      }
    ],
    [
      'glob "?.txt"（? 通配符，不含斜杠）同样走 basename 任意深度分支',
      async () => {
        const grep = setup({
          'a.txt': 'needle',
          docs: { __dir: true, children: { 'b.txt': 'needle', 'cc.txt': 'needle' } }
        });
        const result = await grep({ pattern: 'needle', glob: '?.txt' });
        const text = result.content[0].text;
        assert.ok(text.includes('a.txt:1:'), text);
        assert.ok(text.includes('docs/b.txt:1:'), text);
        assert.ok(!text.includes('cc.txt'), text);
      }
    ],
    [
      'path 指向单个文件时只搜这一个文件，不报错、不递归整棵树',
      async () => {
        const grep = setup({
          'CLAUDE.md': 'needle here',
          docs: { __dir: true, children: { 'other.md': 'needle here too' } }
        });
        const result = await grep({ pattern: 'needle', path: 'CLAUDE.md' });
        const text = result.content[0].text;
        assert.ok(text.includes('CLAUDE.md:1: needle here'), text);
        assert.ok(!text.includes('other.md'), text);
      }
    ],
    [
      'path 指向单个文件时 glob 参数不生效（显式点名的文件不受 glob 过滤，和 ripgrep 一致，P1b）',
      async () => {
        const grep = setup({ 'a.txt': 'needle' });
        const result = await grep({ pattern: 'needle', path: 'a.txt', glob: '*.md' });
        assert.ok(result.content[0].text.includes('a.txt:1:'), result.content[0].text);
      }
    ],
    [
      'path 指向目录时行为不变：递归搜索该目录下所有文件（结果路径相对该起始目录，和改动前行为一致）',
      async () => {
        const grep = setup({
          docs: { __dir: true, children: { 'a.md': 'needle', 'b.md': 'needle' } },
          'root.md': 'needle'
        });
        const result = await grep({ pattern: 'needle', path: 'docs' });
        const text = result.content[0].text;
        assert.ok(text.includes('a.md:1:'), text);
        assert.ok(text.includes('b.md:1:'), text);
        assert.ok(!text.includes('root.md'), text);
      }
    ],
    [
      '命中行过长时只保留匹配点前后约 40 字符，两端用 "..." 省略',
      async () => {
        const padding = 'x'.repeat(100);
        const line = `${padding}needle${padding}`;
        const grep = setup({ 'a.txt': line });
        const result = await grep({ pattern: 'needle' });
        const text = result.content[0].text;
        assert.ok(text.includes('...'), text);
        assert.ok(text.length < line.length, '截断后应该比原始超长行短');
        assert.ok(text.includes('needle'), text);
      }
    ],
    [
      '每行只报告一处命中（一行内多次命中只算一条结果）',
      async () => {
        const grep = setup({ 'a.txt': 'needle needle needle' });
        const result = await grep({ pattern: 'needle' });
        const count = result.content[0].text.split('\n').length;
        assert.strictEqual(count, 1, `一行内多次命中应只产出一条结果，实际:\n${result.content[0].text}`);
      }
    ],
    [
      '含 WSL 私有区字符的文件名：命中路径展示时转义成可见序列',
      async () => {
        const realName = `back${String.fromCodePoint(0xf05c)}slash.txt`;
        const grep = setup({ [realName]: 'needle here' });
        const result = await grep({ pattern: 'needle' });
        assert.ok(result.content[0].text.includes('back\\uF05Cslash.txt:1: needle here'), result.content[0].text);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
