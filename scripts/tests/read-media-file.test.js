// scripts/tests/read-media-file.test.js
// node scripts/tests/read-media-file.test.js
const assert = require('assert');
const { Buffer } = require('buffer');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/fs/limits.js', 'core/tools/read-media-file.js'];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => makeRootHandle(tree) };
  return root.ClaudefsCore.tools;
}

function decodeBase64(data) {
  return Buffer.from(data, 'base64').toString('utf8');
}

async function main() {
  await runTests([
    [
      '图片扩展名 → image content block，base64 往返内容一致',
      async () => {
        const tools = setup({ 'photo.png': 'fake-png-bytes' });
        const result = await tools.read_media_file.handler({ path: 'photo.png' });
        const item = result.content[0];
        assert.strictEqual(item.type, 'image');
        assert.strictEqual(item.mimeType, 'image/png');
        assert.strictEqual(decodeBase64(item.data), 'fake-png-bytes');
        assert.deepStrictEqual(result.structuredContent.content, result.content);
      }
    ],
    [
      '音频扩展名 → audio content block',
      async () => {
        const tools = setup({ 'clip.mp3': 'fake-mp3-bytes' });
        const result = await tools.read_media_file.handler({ path: 'clip.mp3' });
        const item = result.content[0];
        assert.strictEqual(item.type, 'audio');
        assert.strictEqual(item.mimeType, 'audio/mpeg');
        assert.strictEqual(decodeBase64(item.data), 'fake-mp3-bytes');
      }
    ],
    [
      '其他二进制（.bin，未知扩展名）→ resource content block，MIME 归为 application/octet-stream',
      async () => {
        const tools = setup({ 'data.bin': 'fake-arbitrary-bytes' });
        const result = await tools.read_media_file.handler({ path: 'data.bin' });
        const item = result.content[0];
        assert.strictEqual(item.type, 'resource');
        assert.strictEqual(item.resource.mimeType, 'application/octet-stream');
        assert.strictEqual(item.resource.uri, 'claudefs://data.bin');
        assert.strictEqual(decodeBase64(item.resource.blob), 'fake-arbitrary-bytes');
      }
    ],
    [
      '超过媒体读取大小上限 → 报错',
      async () => {
        const tools = setup({ 'big.png': 'x'.repeat(6 * 1024 * 1024) });
        let threw = false;
        try {
          await tools.read_media_file.handler({ path: 'big.png' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('文件太大'), err.message);
          assert.ok(err.message.includes('read_media_file'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '未连接文件夹时报错',
      async () => {
        const root = loadContext(CORE_FILES);
        root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => null };
        let threw = false;
        try {
          await root.ClaudefsCore.tools.read_media_file.handler({ path: 'photo.png' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('尚未连接文件夹'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      '路径越界（sandbox 拒绝 ..）→ 报错',
      async () => {
        const tools = setup({ 'photo.png': 'x' });
        let threw = false;
        try {
          await tools.read_media_file.handler({ path: '../photo.png' });
        } catch (err) {
          threw = true;
          assert.ok(err.message.includes('非法路径'), err.message);
        }
        assert.ok(threw);
      }
    ],
    [
      'read_media_file 出现在 tools/list（非 unlisted）',
      async () => {
        const tools = setup({ 'photo.png': 'x' });
        assert.strictEqual(tools.read_media_file.definition.unlisted, undefined);
        assert.strictEqual(tools.read_media_file.definition.annotations.readOnlyHint, true);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
