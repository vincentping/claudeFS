// core/tools/append-file.js — 宿主无关。
// 扩展工具（官方无对应；扩展原则：重合的不魔改、新能力独立命名、实战痛点驱动）：append-only
// 文档（design-notes、变更日志）是最高频写模式，现状要么整读+整写（贵，diff 巨大且大多是
// 已有内容），要么用 edit_file 匹配文件尾（脆——文件尾内容一变旧的 oldText 就失配）。
//
// 实现要点（省钱的核心）：createWritable({ keepExistingData: true }) + 定位写
// { type: 'write', position: file.size, data: content }，**不把原文件读进内存**，因此
// 不像 write_file/edit_file/replace_lines 那样设 5MB 上限——追加动作本身的开销只取决于
// 追加内容大小，与原文件已有多大无关。
//
// content 原样追加，不自动补换行——调用方如果需要换行分隔，自己在 content 开头带 "\n"；
// 这是刻意的（补不补、补几个换行是内容语义，工具不该替调用方决定）。
// 文件不存在则创建（对齐 shell ">>" 语义：追加到不存在的文件等于新建）。
(function () {
  const NAME = 'append_file';

  const definition = {
    name: NAME,
    title: 'Append File',
    description:
      'Append content to the end of a file, creating it if it does not exist (like shell ">>"). ' +
      '本产品扩展工具，官方无对应。content 原样追加，不自动补换行——需要' +
      '分隔时请在 content 开头自己带 "\\n"。与 write_file/edit_file 不同，本工具不整读原文件' +
      '进内存（只做定位写），因此没有 5MB 大小上限，最适合日志/变更记录这类 append-only 文件' +
      '的高频追加。执行前会弹出确认框，只展示本次要追加的内容（不需要全文 diff）；用户批准后' +
      '才真正写盘，拒绝会返回正常结果（不是错误），文件不会被修改。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的文件路径' },
        content: { type: 'string', description: '要追加到文件末尾的内容，原样追加、不自动补换行' }
      },
      required: ['path', 'content']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: {
      title: 'Append File',
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
    const content = args && typeof args.content === 'string' ? args.content : '';

    // 只读，判断文件是否已存在——不带 create，绝不碰磁盘（与 write_file 同款三步结构）。
    let isNew = true;
    let existingSize = 0;
    let conflictWarning = null;
    try {
      const existingHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, path);
      const existingFile = await existingHandle.getFile();
      existingSize = existingFile.size;
      isNew = false;
      conflictWarning = self.ClaudefsCore.fs.readTracker.checkConflict(path, existingFile.lastModified);
    } catch (e) {
      if (e && e.name === 'NotFoundError') {
        isNew = true;
      } else {
        throw e;
      }
    }

    const { approved } = await self.ClaudefsCore.confirm.requestConfirmation({
      kind: 'append',
      path,
      title: isNew ? `新建文件(追加): ${path}` : `追加到文件: ${path}`,
      fullContent: content,
      warning: conflictWarning || undefined
    });
    if (!approved) {
      return { content: [{ type: 'text', text: '用户取消了这次追加，文件未被修改。' }] };
    }

    // 批准之后才真正碰磁盘。keepExistingData:true 打开写句柄不会截断已有内容；
    // 定位写到 existingSize（新建文件时为 0）之后，等价于纯追加，不读原内容进内存。
    const fileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, path, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: true });
    await writable.write({ type: 'write', position: existingSize, data: content });
    await writable.close();

    const written = await fileHandle.getFile();
    self.ClaudefsCore.fs.readTracker.recordWrite(path, written.lastModified);

    const byteLength = new TextEncoder().encode(content).length;
    const text = isNew
      ? `Successfully created ${path} and appended ${byteLength} bytes`
      : `Successfully appended ${byteLength} bytes to ${path}`;
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
