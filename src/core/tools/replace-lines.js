// core/tools/replace-lines.js — 宿主无关。
// 扩展工具（官方无对应）：edit_file 靠内容精确匹配定位
// （核心安全设计，防止改错地方），擅长"改一小处"，但不擅长"整行/整段重写"——重写时
// 得先把旧内容一字不差地复制出来做 oldText，若旧内容含难打字符会很别扭。replace_lines
// 换一种定位方式：按行号，完全不管旧内容，new_content 为空即等于删掉这几行。
//
// 与 edit_file 的分工（写进 description，防止滥用它绕开 edit_file 的安全匹配）：
//   - edit_file：能用唯一文本定位的小改，首选，对行号变化免疫。
//   - replace_lines：整行/整段重写、或旧内容难以精确复制的场景，按行号、不匹配旧内容。
//
// 边界与 read_file_lines 保持一致（同一套心智模型，不给用户两套记忆）：
//   - start_line / end_line 从 1 开始、都包含在替换区间内。
//   - end_line 超过文件总行数：自动截到文件尾，不报错，返回结果里说明。
//   - start_line 超过文件总行数：报错，附"文件共 N 行"。
//   - start_line > end_line：报错。
//   - 行号基准按 "\n" 计数（不用 /\r?\n/），与 grep_files / read_file_lines / edit_file
//     报错里的行号一致；正确处理 CRLF。
//
// 行号失效风险（已论证为什么不加校验参数）：调用前本就会先读文件拿到当下行号
// （read_file_lines / grep_files），不额外要求 expected_line_count 之类的自证参数——
// 那只是让调用方把刚读到的行数抄一遍，防不了行号真的因为并发编辑而失效这种问题。
// 只把"改动后的新总行数"放进返回结果，作为有用信息（非强制校验）。
(function () {
  const NAME = 'replace_lines';
  // 需要整读全文才能定位替换区间，大小上限见 core/fs/limits.js。

  function stripCR(line) {
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  }

  const definition = {
    name: NAME,
    title: 'Replace Lines',
    description:
      '按行号把已连接文件夹内文本文件的一段区间整体替换成新内容（本产品扩展工具，官方无' +
      '对应）。start_line 和 end_line 都从 1 开始、都包含在被替换的' +
      '区间内；new_content 为空字符串等价于删除这几行。**不匹配旧内容**——这是与 edit_file ' +
      '的关键区别：edit_file 靠精确文本匹配定位、对行号变化免疫，适合"能用唯一文本描述的' +
      '小改"，是首选；replace_lines 按行号定位、完全不看旧内容，适合"整行/整段重写"或者' +
      '"旧内容里有特殊字符、难以在 oldText 里精确复制"的场景。不要仅仅因为不想在 edit_file ' +
      '里精确复制旧文本，就用 replace_lines 绕开它的安全匹配去做本该用 edit_file 的小改。' +
      '调用前建议先用 read_file_lines 或 grep_files 确认当前的行号（行号基准与这两个工具、' +
      'edit_file 报错里的行号一致，均按 "\\n" 计数）。end_line 超过文件总行数会自动截到' +
      '文件尾并说明，不报错；start_line 超过总行数会报错并附"文件共 N 行"。执行前会弹出 ' +
      'diff 确认框展示第 start_line-end_line 行 旧→新，用户批准后才真正写盘；用户拒绝会' +
      '返回正常结果（不是错误），文件不会被修改。返回结果包含替换后的文件新总行数。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的文件路径' },
        start_line: { type: 'number', description: '起始行号，从 1 开始（含），被替换区间的第一行' },
        end_line: { type: 'number', description: '结束行号（含）。超过文件总行数会自动截到文件尾并说明，不报错。' },
        new_content: { type: 'string', description: '替换成的新内容（可含多行，用 \\n 分隔）；空字符串等价于删除这几行' }
      },
      required: ['path', 'start_line', 'end_line', 'new_content']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: {
      title: 'Replace Lines',
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: true,
      openWorldHint: false
    }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const path = args && args.path;
    const startLine = args && args.start_line;
    const endLine = args && args.end_line;
    const newContent = args && typeof args.new_content === 'string' ? args.new_content : '';

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
      throw new Error(`文件太大（${file.size} 字节），超过上限 ${maxBytes} 字节，replace_lines 暂不支持`);
    }

    const originalContent = await file.text();
    const lines = originalContent.split('\n');
    const totalLines = lines.length;

    if (startLine > totalLines) {
      throw new Error(`start_line (${startLine}) 超过文件总行数（文件共 ${totalLines} 行）`);
    }

    const actualEnd = Math.min(endLine, totalLines);
    const before = lines.slice(0, startLine - 1);
    const after = lines.slice(actualEnd);
    const newLines = newContent === '' ? [] : newContent.split('\n');
    const modifiedLines = before.concat(newLines).concat(after);
    const modifiedContent = modifiedLines.join('\n');

    const oldSectionText = lines
      .slice(startLine - 1, actualEnd)
      .map((line, idx) => `${startLine + idx}: ${stripCR(line)}`)
      .join('\n');

    const diffLines = self.ClaudefsCore.diff.computeLineDiff(originalContent, modifiedContent);
    const diffText = self.ClaudefsCore.diff.formatDiffText(diffLines, 3);

    const notes = [];
    if (actualEnd < endLine) {
      notes.push(`end_line (${endLine}) 超过文件总行数，已截到文件尾（文件共 ${totalLines} 行）`);
    }

    const conflictWarning = self.ClaudefsCore.fs.readTracker.checkConflict(path, file.lastModified);

    const { approved } = await self.ClaudefsCore.confirm.requestConfirmation({
      kind: 'replace-lines',
      path,
      title: `替换第 ${startLine}-${actualEnd} 行: ${path}`,
      diffLines,
      fullContent:
        `第 ${startLine}-${actualEnd} 行 旧内容:\n${oldSectionText || '(空)'}\n\n` +
        `新内容:\n${newContent || '(空，即删除这几行)'}`,
      warning: conflictWarning || undefined
    });
    if (!approved) {
      return { content: [{ type: 'text', text: '用户取消了这次替换，文件未被修改。' }] };
    }

    const writable = await fileHandle.createWritable();
    await writable.write(modifiedContent);
    await writable.close();

    const written = await fileHandle.getFile();
    self.ClaudefsCore.fs.readTracker.recordWrite(path, written.lastModified);

    const newTotalLines = modifiedLines.length;
    const summary = [`Successfully replaced lines ${startLine}-${actualEnd} in ${path}`]
      .concat(notes)
      .concat([`文件替换后共 ${newTotalLines} 行`])
      .join('；');

    const text = `${summary}\n\n${diffText}`;
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
