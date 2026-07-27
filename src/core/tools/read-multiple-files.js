// core/tools/read-multiple-files.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 read_multiple_files：
//   input:  { paths: string[] }（至少 1 个）
//   output: 纯文本，每个文件一段 "${path}:\n${content}\n"，各段之间用 "\n---\n" 连接；
//           单个文件读取失败不影响其它文件，失败的那段写成 "${path}: Error - ${message}"
//   annotations: { readOnlyHint: true }
// （schema 已核对官方 v2026.7.4 源码确认。）
//
// 与官方的刻意差异：官方直接 fs.readFile，没有大小上限也不拒绝二进制；本产品复用
// read_file/read_text_file 同款的二进制嗅探（core/fs/binary-detect.js）与整读大小上限，
// 单个文件命中这两条限制时按官方"失败不影响其它文件"的模式处理——把它变成该文件对应的
// 错误段，而不是让整个调用失败。
(function () {
  const NAME = 'read_multiple_files';

  async function readOne(root, filePath) {
    const fileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, filePath);
    const file = await fileHandle.getFile();
    const maxBytes = self.ClaudefsCore.fs.limits.MAX_READ_BYTES;
    if (file.size > maxBytes) {
      throw new Error(`文件太大（${file.size} 字节），超过整读上限 ${maxBytes} 字节`);
    }
    const reason = await self.ClaudefsCore.fs.binaryDetect.detectBinaryReason(file);
    if (reason) {
      throw new Error(`${reason}，暂不支持读取`);
    }
    const content = await file.text();
    self.ClaudefsCore.fs.readTracker.recordRead(filePath, file.lastModified);
    return content;
  }

  const definition = {
    name: NAME,
    title: 'Read Multiple Files',
    description:
      "Read the contents of multiple files simultaneously. This is more efficient than reading files " +
      "one by one when you need to analyze or compare multiple files. Each file's content is returned " +
      'with its path as a reference; individual file failures don\'t stop the rest. ' +
      '某个文件读取失败（不存在、太大、疑似二进制）只会让它对应的那一段变成错误说明，不影响' +
      '其它文件正常返回；二进制判定与大小上限和 read_text_file 一致。',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: '要读取的文件路径列表，每个都是相对已连接文件夹的相对路径'
        }
      },
      required: ['paths']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: { title: 'Read Multiple Files', readOnlyHint: true, destructiveHint: false }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const paths = args && Array.isArray(args.paths) ? args.paths : [];
    if (paths.length === 0) {
      throw new Error('paths 不能为空');
    }

    const results = await Promise.all(
      paths.map(async (p) => {
        try {
          const content = await readOne(root, p);
          return `${p}:\n${content}\n`;
        } catch (err) {
          return `${p}: Error - ${err.message}`;
        }
      })
    );

    const text = results.join('\n---\n');
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
