// core/tools/read-media-file.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 read_media_file：
//   input:  { path: string }
//   output: 图片/音频作为 image/audio content block；其余任意类型作为 resource content
//           block；MIME 按扩展名推断，未知扩展名归为 application/octet-stream。
// （schema 与 MIME 映射表已核对官方 main 分支源码 src/filesystem/index.ts 确认，不是凭记忆
// 猜的：ReadMediaFileArgsSchema 只有 path；mimeTypes 表覆盖 png/jpg/jpeg/gif/webp/bmp/svg/
// mp3/wav/ogg/flac 共 11 个扩展名；无大小上限。）
//
// 与官方的刻意差异（均已确认属于本产品的真实缺口，不是遗漏）：
//   - 官方无大小上限（Node fs 直接读）；本产品加了独立的 MAX_MEDIA_READ_BYTES 整读上限
//     （见 core/fs/limits.js 头部注释），超限报错，不做流式分批返回（MCP 工具结果本就是
//     一次性返回，分批对模型侧没有意义）。
//   - resource block 的 uri：官方是 pathToFileURL(绝对磁盘路径)，我们的沙盒 handle 不暴露
//     绝对磁盘路径（隐私考虑，File System Access API 本身就不给），也没必要伪造一个不可
//     解析的 file:// 路径误导模型；改用 `claudefs://<相对已连接文件夹的规范化路径>` 表达
//     "这是哪个文件"，明确标注不是真实可解析的 URL。
//   - 不经 core/fs/binary-detect.js 的二进制嗅探拒绝：media 本来就是读二进制，这正是它与
//     read_text_file 的分工边界，两者不应共用"拒绝二进制"这条逻辑。
(function () {
  // btoa 单次处理的字节窗口：String.fromCharCode.apply 对参数个数有上限（不同引擎的调用栈
  // 上限不同，但远小于典型媒体文件的字节数），必须分块拼字符串，只在最后对完整二进制字符串
  // 调一次 btoa。这不是内存优化（MAX_MEDIA_READ_BYTES 已经把体积卡在几 MB 量级），是绕开
  // 调用栈参数上限这个硬限制。
  const BASE64_CHUNK_BYTES = 0x8000;

  const MIME_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac'
  };

  function inferMimeType(name) {
    const dot = name.lastIndexOf('.');
    if (dot === -1) return 'application/octet-stream';
    return MIME_TYPES[name.slice(dot + 1).toLowerCase()] || 'application/octet-stream';
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK_BYTES));
    }
    return btoa(binary);
  }

  const inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对已连接文件夹的文件路径' }
    },
    required: ['path']
  };

  const outputSchema = {
    type: 'object',
    properties: {
      content: {
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              properties: {
                type: { enum: ['image', 'audio'] },
                data: { type: 'string' },
                mimeType: { type: 'string' }
              },
              required: ['type', 'data', 'mimeType']
            },
            {
              type: 'object',
              properties: {
                type: { const: 'resource' },
                resource: {
                  type: 'object',
                  properties: {
                    uri: { type: 'string' },
                    mimeType: { type: 'string' },
                    blob: { type: 'string' }
                  },
                  required: ['uri', 'blob']
                }
              },
              required: ['type', 'resource']
            }
          ]
        }
      }
    },
    required: ['content']
  };

  async function readMediaFileHandler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const fileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, args && args.path);
    const file = await fileHandle.getFile();

    const maxBytes = self.ClaudefsCore.fs.limits.MAX_MEDIA_READ_BYTES;
    if (file.size > maxBytes) {
      throw new Error(
        `文件太大（${file.size} 字节），超过 read_media_file 的整读上限 ${maxBytes} 字节；` +
          `该工具会把整个文件编码进 base64 一次性返回，不支持超限文件。`
      );
    }

    const mimeType = inferMimeType(file.name);
    const data = arrayBufferToBase64(await file.arrayBuffer());

    let contentItem;
    if (mimeType.startsWith('image/')) {
      contentItem = { type: 'image', data, mimeType };
    } else if (mimeType.startsWith('audio/')) {
      contentItem = { type: 'audio', data, mimeType };
    } else {
      const normalizedPath = self.ClaudefsCore.fs.sandbox.normalizePathForTracking(args.path);
      contentItem = {
        type: 'resource',
        resource: { uri: `claudefs://${normalizedPath}`, mimeType, blob: data }
      };
    }

    return {
      content: [contentItem],
      structuredContent: { content: [contentItem] }
    };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};

  self.ClaudefsCore.tools.read_media_file = {
    definition: {
      name: 'read_media_file',
      title: 'Read Media File',
      description:
        '读取图片、音频或任意其他文件并转为 base64 返回：图片/音频作为对应的 image/audio ' +
        'content block 返回，其他文件类型作为 resource content block 返回。MIME 类型按扩展名' +
        '推断，未知扩展名归为 application/octet-stream。受独立的媒体读取大小上限限制，超限报错。',
      inputSchema,
      outputSchema,
      annotations: { title: 'Read Media File', readOnlyHint: true, destructiveHint: false }
    },
    handler: readMediaFileHandler
  };
})();
