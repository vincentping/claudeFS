// core/tools/read-file.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 read_file / read_text_file：
//   input:  { path: string, tail?: number, head?: number }（head 和 tail 不能同时给）
//   output: { content: [{type:'text', text}], structuredContent: { content: text } }
//   read_file 官方标为 deprecated，指向 read_text_file，二者共用实现。
// （schema 已核对官方 v2026.7.4 源码确认，不是凭记忆猜的。）
//
// 与官方的刻意差异（均已确认属于本产品的真实缺口，不是遗漏）：
//   - head/tail 用流式/分块读取，只读需要的那部分，不整读文件、不受大小上限限制；
//     "整读"（既不给 head 也不给 tail）才套 MAX_BYTES 上限。
//   - 读之前用共享的 core/fs/binary-detect.js 做二进制嗅探，拒绝明显的二进制文件并给清晰
//     错误，而不是把 file.text() 解码出来的乱码原样返回给 Claude（二进制探测逻辑原先是本
//     文件的私有实现，与共享模块重复维护，已合并——见 core/fs/binary-detect.js 头部注释）。
(function () {
  const TAIL_CHUNK_BYTES = 64 * 1024;

  async function rejectIfBinary(file) {
    const reason = await self.ClaudefsCore.fs.binaryDetect.detectBinaryReason(file);
    if (reason) {
      throw new Error(`${reason}，暂不支持读取（二阶段的 read_media_file 会支持）。`);
    }
  }

  // 只读前 N 行：用流式读取增量解码，攒够 N 行就停，不读文件剩余部分。
  async function readHead(file, n) {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lines = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          lines = buffer.split('\n');
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        lines = buffer.split('\n');
        if (lines.length > n) break;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return lines.slice(0, n).join('\n');
  }

  // 只读后 N 行：从文件末尾往前一块块读，攒够 N 行就停。
  // 已知的小局限：每块独立按 UTF-8 解码，如果多字节字符恰好跨在块边界上，边界处那一个
  // 字符可能解码成替换符——只影响边界那一处，权衡了实现复杂度后接受这个局限。
  async function readTail(file, n) {
    let position = file.size;
    let buffer = '';
    let lines = [];
    while (position > 0 && lines.length <= n) {
      const start = Math.max(0, position - TAIL_CHUNK_BYTES);
      const chunk = await file.slice(start, position).text();
      buffer = chunk + buffer;
      lines = buffer.split('\n');
      position = start;
    }
    return lines.slice(Math.max(0, lines.length - n)).join('\n');
  }

  const inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对已连接文件夹的文件路径' },
      tail: { type: 'number', description: '只返回最后 N 行' },
      head: { type: 'number', description: '只返回最前 N 行' }
    },
    required: ['path']
  };

  const outputSchema = {
    type: 'object',
    properties: { content: { type: 'string' } },
    required: ['content']
  };

  async function readHandler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }
    if (args && args.head != null && args.tail != null) {
      throw new Error('head 和 tail 不能同时指定');
    }

    const fileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, args && args.path);
    const file = await fileHandle.getFile();

    await rejectIfBinary(file);

    let text;
    if (args && args.head != null) {
      text = await readHead(file, args.head);
    } else if (args && args.tail != null) {
      text = await readTail(file, args.tail);
    } else {
      const maxBytes = self.ClaudefsCore.fs.limits.MAX_READ_BYTES;
      if (file.size > maxBytes) {
        throw new Error(
          `文件太大（${file.size} 字节），超过整读上限 ${maxBytes} 字节；可以用 head 或 tail 参数只读部分内容`
        );
      }
      text = await file.text();
    }

    self.ClaudefsCore.fs.readTracker.recordRead(args.path, file.lastModified);

    return {
      content: [{ type: 'text', text }],
      structuredContent: { content: text }
    };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};

  self.ClaudefsCore.tools.read_file = {
    definition: {
      name: 'read_file',
      title: 'Read File (Deprecated)',
      description: 'Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.',
      inputSchema,
      outputSchema,
      annotations: { title: 'Read File (Deprecated)', readOnlyHint: true, destructiveHint: false },
      // 不再对 Claude 暴露（dispatch.listTools 会过滤掉带 unlisted 的工具），省一条
      // description 的 token；代码/契约/callTool 均保留，官方对齐 14 个的台账不变。
      unlisted: true
    },
    handler: readHandler
  };

  self.ClaudefsCore.tools.read_text_file = {
    definition: {
      name: 'read_text_file',
      title: 'Read Text File',
      description: '以文本方式读取已连接文件夹内的文件，可选只读前 N 行或后 N 行。二进制文件会被拒绝并报错。',
      inputSchema,
      outputSchema,
      annotations: { title: 'Read Text File', readOnlyHint: true, destructiveHint: false }
    },
    handler: readHandler
  };
})();
