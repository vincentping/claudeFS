// scripts/tests/copy-file.test.js
// node scripts/tests/copy-file.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/tools/copy-file.js'];

function setup(tree, { approve = true, expectNoConfirm = false } = {}) {
  const root = loadContext(CORE_FILES);
  const rootHandle = makeRootHandle(tree);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
  let lastPayload = null;
  root.ClaudefsCore.confirm = {
    requestConfirmation: async (payload) => {
      lastPayload = payload;
      if (expectNoConfirm) throw new Error('不应该走到确认弹窗');
      return { approved: approve };
    }
  };
  return {
    copy: root.ClaudefsCore.tools.copy_file.handler,
    tree,
    root,
    getLastPayload: () => lastPayload
  };
}

async function main() {
  await runTests([
    [
      '用户批准：源文件保留，目标出现相同内容，返回成功文本',
      async () => {
        const { copy, tree, getLastPayload } = setup({ 'a.txt': 'hello' });
        const result = await copy({ source: 'a.txt', destination: 'b.txt' });
        assert.ok(result.content[0].text.includes('Successfully copied a.txt to b.txt'), result.content[0].text);
        assert.strictEqual(tree['a.txt'].toString(), 'hello', '源文件应该保留（copy 不是 move）');
        assert.strictEqual(tree['b.txt'].toString(), 'hello');
        const payload = getLastPayload();
        assert.ok(payload.fullContent.includes('复制: a.txt → b.txt'), JSON.stringify(payload));
      }
    ],
    [
      '用户拒绝：不创建任何文件，返回取消文本（不是错误）',
      async () => {
        const { copy, tree } = setup({ 'a.txt': 'hello' }, { approve: false });
        const result = await copy({ source: 'a.txt', destination: 'b.txt' });
        assert.ok(result.content[0].text.includes('用户取消'), result.content[0].text);
        assert.strictEqual(tree['b.txt'], undefined, '目标不应该被创建');
      }
    ],
    [
      '目标已存在：报错，不弹确认框，不覆盖',
      async () => {
        const { copy, tree } = setup({ 'a.txt': 'hello', 'b.txt': 'existing' }, { expectNoConfirm: true });
        let threw = false;
        try {
          await copy({ source: 'a.txt', destination: 'b.txt' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('目标已存在'), err.message);
        }
        assert.ok(threw);
        assert.strictEqual(tree['b.txt'].toString(), 'existing', '目标不应被覆盖');
      }
    ],
    [
      '源是目录：报错，不支持复制目录',
      async () => {
        const { copy } = setup({ src: { __dir: true, children: {} } }, { expectNoConfirm: true });
        let threw = false;
        try {
          await copy({ source: 'src', destination: 'dst' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('不支持复制目录'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      'source/destination 缺失时报错',
      async () => {
        const { copy } = setup({}, { expectNoConfirm: true });
        let threw = false;
        try {
          await copy({ source: '', destination: '' });
        } catch (err) {
          threw = true;
        }
        assert.ok(threw);
      }
    ],
    [
      '没有 5MB 上限：超大文件（流式直拷）也能成功复制',
      async () => {
        const big = Buffer.alloc(6 * 1024 * 1024, 'x'); // 超过 write_file/move_file 的 5MB 上限
        const { copy, tree } = setup({ 'big.bin': big });
        const result = await copy({ source: 'big.bin', destination: 'big-copy.bin' });
        assert.ok(result.content[0].text.includes('Successfully copied'), result.content[0].text);
        assert.strictEqual(tree['big-copy.bin'].length, big.length);
      }
    ],
    [
      '管道中途失败：尽力删除写了一半的目标文件，错误信息说明目标状态',
      async () => {
        const { copy, tree, root } = setup({ 'a.txt': 'hello world' });
        const rootHandle = root.ClaudefsCore.fs.handleStore.getCurrentHandle();

        // monkey-patch resolveFile：目标文件的 createWritable().write() 第一次调用就抛错，
        // 模拟"管道写到一半失败"（真实场景如磁盘写入错误/权限被收回）。
        const originalResolveFile = root.ClaudefsCore.fs.sandbox.resolveFile;
        root.ClaudefsCore.fs.sandbox.resolveFile = async (r, path, opts) => {
          const handle = await originalResolveFile(r, path, opts);
          if (path !== 'destination-will-fail.txt') return handle;
          return {
            ...handle,
            async createWritable() {
              return {
                async write() {
                  throw new Error('模拟磁盘写入失败');
                },
                async close() {}
              };
            }
          };
        };

        let threw = false;
        try {
          await copy({ source: 'a.txt', destination: 'destination-will-fail.txt' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('复制失败'), err.message);
          assert.ok(err.message.includes('已清理') || err.message.includes('清理'), err.message);
        }
        assert.ok(threw, '管道失败应该抛错而不是静默返回成功');
        assert.strictEqual(tree['destination-will-fail.txt'], undefined, '失败后应清理写了一半的目标文件');
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
