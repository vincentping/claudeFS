// core/tools/insert-lines.js — 宿主无关。
// 扩展工具（官方无对应）：replace_lines 只能替换一个既有区间，纯插入（不删除/替换
// 任何既有行）需要连带把插入点前后一行抄进 new_content 一起重写，啰嗦且容易抄错、抄漏。
// insert_lines 用单一 after_line 参数表达"插到哪之后"，无 before/after 双模式的歧义。
//
// 边界与 replace_lines / read_file_lines / grep_files 保持一致（同一套心智模型）：
//   - after_line 取 0 到文件总行数：0 = 插到文件最前，N = 插到第 N 行之后；
//     超过总行数报错并附"文件共 N 行"。
//   - 行号基准按 "\n" 计数（不用 /\r?\n/），与其它按行工具一致，正确处理 CRLF。
//   - content 按 "\n" 拆行插入；5MB 上限（与 edit_file/replace_lines 同理由：需整读全文
//     才能定位插入点、生成 diff）。
(function () {
  const NAME = 'insert_lines';

  const definition = {
    name: NAME,
    title: 'Insert Lines',
    description:
      '在已连接文件夹内文本文件的指定行之后插入新内容（本产品扩展工具，官方无对应）。' +
      'after_line 取 0 到文件总行数：0 表示插到文件最前，N 表示插到第 ' +
      'N 行之后；超过文件总行数会报错并附"文件共 N 行"。与 replace_lines 的分工：纯插入' +
      '（不删除/替换任何既有行）用 insert_lines；需要替换或删除既有区间用 replace_lines。' +
      '行号基准与 read_file_lines / replace_lines / grep_files 完全一致（按 "\\n" 计数，正确' +
      '处理 CRLF）。content 按 "\\n" 拆分成多行插入。执行前会弹出 diff 确认框，标题「在第 ' +
      'after_line 行后插入」（after_line 为 0 时「在文件开头插入」），用户批准后才真正写盘；' +
      '用户拒绝会返回正常结果（不是错误），文件不会被修改。返回结果包含插入后的文件新总行数。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的文件路径' },
        after_line: { type: 'number', description: '插入位置：0 表示插到文件最前，N 表示插到第 N 行之后（从 1 开始计数）' },
        content: { type: 'string', description: '要插入的内容（可含多行，用 \\n 分隔）' }
      },
      required: ['path', 'after_line', 'content']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: {
      title: 'Insert Lines',
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
    const afterLine = args && args.after_line;
    const content = args && typeof args.content === 'string' ? args.content : '';

    if (!Number.isInteger(afterLine) || afterLine < 0) {
      throw new Error('after_line 必须是 >= 0 的整数');
    }

    const fileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, path);
    const file = await fileHandle.getFile();
    const maxBytes = self.ClaudefsCore.fs.limits.MAX_READ_BYTES;
    if (file.size > maxBytes) {
      throw new Error(`文件太大（${file.size} 字节），超过上限 ${maxBytes} 字节，insert_lines 暂不支持`);
    }

    const originalContent = await file.text();
    const lines = originalContent.split('\n');
    const totalLines = lines.length;

    if (afterLine > totalLines) {
      throw new Error(`after_line (${afterLine}) 超过文件总行数（文件共 ${totalLines} 行）`);
    }

    const before = lines.slice(0, afterLine);
    const after = lines.slice(afterLine);
    const insertedLines = content === '' ? [] : content.split('\n');
    const modifiedLines = before.concat(insertedLines).concat(after);
    const modifiedContent = modifiedLines.join('\n');

    const diffLines = self.ClaudefsCore.diff.computeLineDiff(originalContent, modifiedContent);
    const conflictWarning = self.ClaudefsCore.fs.readTracker.checkConflict(path, file.lastModified);

    const { approved } = await self.ClaudefsCore.confirm.requestConfirmation({
      kind: 'insert-lines',
      path,
      title: afterLine === 0 ? `Insert at start of file: ${path}` : `Insert after line ${afterLine}: ${path}`,
      diffLines,
      warning: conflictWarning || undefined
    });
    if (!approved) {
      return { content: [{ type: 'text', text: '用户取消了这次插入，文件未被修改。' }] };
    }

    const writable = await fileHandle.createWritable();
    await writable.write(modifiedContent);
    await writable.close();

    const written = await fileHandle.getFile();
    self.ClaudefsCore.fs.readTracker.recordWrite(path, written.lastModified);

    const newTotalLines = modifiedLines.length;
    const text = `Successfully inserted content after line ${afterLine} in ${path}；文件插入后共 ${newTotalLines} 行`;
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
