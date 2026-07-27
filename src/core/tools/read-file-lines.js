// core/tools/read-file-lines.js — 宿主无关。
// 扩展工具（官方无对应；立项理由：长文档只能整读或 head/tail，都不够精确定位到任意
// 区间；不给官方 read_text_file 加参数——不魔改官方契约——所以独立开一个新工具。和
// grep_files 配套成"搜索定位 → 按行精读 → edit_file 精确修改"的完整流程）。
//
// 边界行为（今天定死的规格）：
//   - start_line / end_line 都从 1 开始、都包含在结果内。
//   - start_line 超过文件总行数报错，错误信息附"文件共 N 行"。
//   - end_line 超过文件总行数不报错，自动截到文件尾并在返回内容里说明。
//   - 正确处理 CRLF：行末的 '\r' 只在展示内容时去掉，不影响行号计数。
//   - 行号基准：按 '\n' 计数（不用 /\r?\n/），与 grep_files 的命中行号、edit_file 报错里的
//     行号完全一致，三者可以配合使用（见 scripts/tests 里的跨工具一致性用例）。
//   - 复用流式读取（攒够 end_line 行就停），不整读大文件；二进制文件拒绝并报错
//     （复用 core/fs/binary-detect.js）。
(function () {
  const NAME = 'read_file_lines';

  // 流式读取，边解码边按 '\n' 切分累计行数，一旦攒够超过 endLine 行就停止读取剩余内容——
  // 不整读大文件。这段"攒够 n 行就停"的技巧和 read-file.js 的 readHead 同源（各自独立
  // 实现，未合并成共享函数，是本次任务刻意最小改动范围的取舍，见提交说明）。
  async function readLineRange(file, endLine) {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lines = [];
    let doneAll = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          lines = buffer.split('\n');
          doneAll = true;
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        lines = buffer.split('\n');
        if (lines.length > endLine) break;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return { lines, doneAll };
  }

  function stripCR(line) {
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  }

  const definition = {
    name: NAME,
    title: 'Read File Lines',
    description:
      '按行区间读取已连接文件夹内文本文件的一段内容（本产品扩展工具，官方 read_text_file ' +
      '只支持整读/head/tail，没有任意区间；不给官方工具加参数，另立此工具）。' +
      'start_line 和 end_line 都从 1 开始、都包含在返回内容里。start_line 超过文件' +
      '总行数会报错，错误信息里会附上"文件共 N 行"；end_line 超过文件总行数不会报错，会' +
      '自动截到文件尾，并在返回内容末尾说明实际截到了第几行、文件共多少行。行号基准与 ' +
      'grep_files 命中结果里的行号、edit_file 报错里的行号完全一致（都是按 "\\n" 计数），' +
      '三者可以配合使用：grep_files 定位命中行 → read_file_lines 读取该行前后的上下文 → ' +
      'edit_file 精确修改。正确处理 CRLF（\\r\\n）换行——每行末尾的 \\r 只在展示内容时去掉，' +
      '不影响行号。复用流式读取，不会把整个大文件读进内存。二进制文件会被拒绝并报错。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的文件路径' },
        start_line: { type: 'number', description: '起始行号，从 1 开始（含）' },
        end_line: { type: 'number', description: '结束行号（含）。超过文件总行数会自动截到文件尾并说明，不报错。' }
      },
      required: ['path', 'start_line', 'end_line']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: { title: 'Read File Lines', readOnlyHint: true, destructiveHint: false }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const path = args && args.path;
    const startLine = args && args.start_line;
    const endLine = args && args.end_line;

    if (!Number.isInteger(startLine) || startLine < 1) {
      throw new Error('start_line 必须是 >= 1 的整数');
    }
    if (!Number.isInteger(endLine) || endLine < startLine) {
      throw new Error('end_line 必须是 >= start_line 的整数');
    }

    const fileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, path);
    const file = await fileHandle.getFile();
    const maxBytes = self.ClaudefsCore.fs.limits.MAX_READ_BYTES;
    if (file.size > maxBytes) {
      throw new Error(`文件太大（${file.size} 字节），超过上限 ${maxBytes} 字节，read_file_lines 暂不支持`);
    }

    const reason = await self.ClaudefsCore.fs.binaryDetect.detectBinaryReason(file);
    if (reason) {
      throw new Error(`${reason}，暂不支持读取。`);
    }

    const { lines, doneAll } = await readLineRange(file, endLine);
    const knownTotal = lines.length; // doneAll 为 true 时是真实总行数，否则是"已确认至少这么多行"的下限

    if (startLine > knownTotal) {
      throw new Error(`start_line (${startLine}) 超过文件总行数（文件共 ${knownTotal} 行）`);
    }

    const actualEnd = Math.min(endLine, knownTotal);
    const selected = lines.slice(startLine - 1, actualEnd);
    const body = selected.map((line, idx) => `${startLine + idx}: ${stripCR(line)}`).join('\n');

    const notes = [];
    if (actualEnd < endLine) {
      notes.push(`end_line (${endLine}) 超过文件总行数，已截到文件尾（文件共 ${knownTotal} 行）`);
    } else if (doneAll) {
      notes.push(`文件共 ${knownTotal} 行`);
    } else {
      notes.push(`已返回请求的第 ${startLine}–${endLine} 行；文件在第 ${endLine} 行之后仍有内容（本次未读到文件尾、未统计总行数，需要精确总行数可用 get_file_info）`);
    }

    const text = `${body}\n\n（${notes.join('；')}）`;

    self.ClaudefsCore.fs.readTracker.recordRead(path, file.lastModified);

    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
