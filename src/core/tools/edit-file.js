// core/tools/edit-file.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 edit_file：
//   input:  { path: string, edits: [{oldText: string, newText: string}], dryRun?: boolean }
//   output: { content: [{type:'text', text: diffText}], structuredContent: { content: diffText } }
//   annotations: { title:"Edit File", readOnlyHint:false, idempotentHint:false, destructiveHint:true, openWorldHint:false }
// （schema 已核对官方 v2026.7.4 源码确认：lib.ts 的 applyFileEdits 先试精确子串匹配，
//  找不到再降级成按行、掐头去尾空白的宽松匹配；多个 edits 顺序应用，后一个在前一个的
//  结果上继续匹配。）
//
// ⚠️ 刻意背离官方的一点（docs/archives/20260714_review_2_reply.md 决策 4，已确认）：官方
// 遇到 oldText 匹配到多处时**不报错**，用 String.replace() 不带 global 标志静默只替换第一次
// 出现的位置。这里不照抄——edit_file 是破坏性操作，"悄悄选中某一处、用户可能没注意到改的是
// 哪里"是真实的正确性风险，两级匹配（精确 / 行级宽松）**都**要求恰好命中 1 处，0 处或 >1 处
// 都报错，错误信息带上命中位置的行号提示，方便 Claude 据此给 oldText 补充上下文重试。
(function () {
  const NAME = 'edit_file';
  // 需要整读全文才能定位/替换，大小上限见 core/fs/limits.js。

  function findExactMatches(content, oldText) {
    const matches = [];
    let fromIndex = 0;
    while (true) {
      const idx = content.indexOf(oldText, fromIndex);
      if (idx === -1) break;
      matches.push(idx);
      fromIndex = idx + oldText.length;
    }
    return matches;
  }

  function lineNumberAt(content, index) {
    let line = 1;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === '\n') line++;
    }
    return line;
  }

  function tryLineMatch(contentLines, oldLines) {
    const matches = [];
    const n = contentLines.length;
    const m = oldLines.length;
    if (m === 0 || m > n) return matches;
    for (let start = 0; start <= n - m; start++) {
      let ok = true;
      for (let k = 0; k < m; k++) {
        if (contentLines[start + k].trim() !== oldLines[k].trim()) {
          ok = false;
          break;
        }
      }
      if (ok) matches.push(start);
    }
    return matches;
  }

  function applyOneEdit(content, oldText, newText) {
    const exactMatches = findExactMatches(content, oldText);
    if (exactMatches.length === 1) {
      const idx = exactMatches[0];
      return content.slice(0, idx) + newText + content.slice(idx + oldText.length);
    }
    if (exactMatches.length > 1) {
      const lineHints = exactMatches.map((idx) => lineNumberAt(content, idx)).join('、');
      throw new Error(
        `oldText 精确匹配到 ${exactMatches.length} 处（约第 ${lineHints} 行附近），不唯一，无法确定替换哪一处。请给 oldText 补充更多上下文使其唯一。`
      );
    }

    // 精确匹配 0 处，降级到按行、掐头去尾空白的宽松匹配。
    const contentLines = content.split('\n');
    const oldLines = oldText.split('\n');
    const lineMatches = tryLineMatch(contentLines, oldLines);
    if (lineMatches.length === 1) {
      const start = lineMatches[0];
      const before = contentLines.slice(0, start);
      const after = contentLines.slice(start + oldLines.length);
      return before.concat(newText.split('\n')).concat(after).join('\n');
    }
    if (lineMatches.length > 1) {
      const lineHints = lineMatches.map((start) => start + 1).join('、');
      throw new Error(
        `oldText 按行宽松匹配（忽略首尾空白）后仍匹配到 ${lineMatches.length} 处（第 ${lineHints} 行附近），不唯一。请给 oldText 补充更多上下文使其唯一。`
      );
    }

    throw new Error(`找不到匹配的 oldText:\n${oldText}`);
  }

  const definition = {
    name: NAME,
    title: 'Edit File',
    description:
      '对已连接文件夹内的文件做局部字符串替换。oldText 必须在文件中唯一匹配' +
      '（精确匹配优先，找不到则降级为按行、忽略首尾空白的宽松匹配；两种情况下匹配到 0 处或 ' +
      '多于 1 处都会报错并提示大致行号，不会静默选中某一处）。多个 edits 按顺序应用，' +
      '后一个在前一个的结果上继续匹配。dryRun 为 true 时只返回预览 diff，不写盘、不弹确认框。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的文件路径' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string', description: '要查找的文本，必须在文件中唯一匹配' },
              newText: { type: 'string', description: '替换成的文本' }
            },
            required: ['oldText', 'newText']
          },
          description: '按顺序应用的编辑列表'
        },
        dryRun: { type: 'boolean', description: '为 true 时只返回预览 diff，不写盘、不弹确认框' }
      },
      required: ['path', 'edits']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: {
      title: 'Edit File',
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
    const edits = args && Array.isArray(args.edits) ? args.edits : [];
    if (edits.length === 0) {
      throw new Error('edits 不能为空');
    }

    const fileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, path);
    const file = await fileHandle.getFile();
    const maxBytes = self.ClaudefsCore.fs.limits.MAX_READ_BYTES;
    if (file.size > maxBytes) {
      throw new Error(`文件太大（${file.size} 字节），超过上限 ${maxBytes} 字节，edit_file 暂不支持`);
    }
    const originalContent = await file.text();

    let modifiedContent = originalContent;
    for (const edit of edits) {
      modifiedContent = applyOneEdit(modifiedContent, edit.oldText, edit.newText);
    }

    const diffLines = self.ClaudefsCore.diff.computeLineDiff(originalContent, modifiedContent);
    const diffText = self.ClaudefsCore.diff.formatDiffText(diffLines, 3);

    if (args && args.dryRun) {
      return { content: [{ type: 'text', text: diffText }], structuredContent: { content: diffText } };
    }

    const conflictWarning = self.ClaudefsCore.fs.readTracker.checkConflict(path, file.lastModified);

    const { approved } = await self.ClaudefsCore.confirm.requestConfirmation({
      kind: 'edit',
      path,
      title: `编辑文件: ${path}`,
      diffLines,
      warning: conflictWarning || undefined
    });
    if (!approved) {
      return { content: [{ type: 'text', text: '用户取消了这次修改，文件未被写入。' }] };
    }

    const writable = await fileHandle.createWritable();
    await writable.write(modifiedContent);
    await writable.close();

    const written = await fileHandle.getFile();
    self.ClaudefsCore.fs.readTracker.recordWrite(path, written.lastModified);

    return { content: [{ type: 'text', text: diffText }], structuredContent: { content: diffText } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
