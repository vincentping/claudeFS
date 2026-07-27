// core/tools/write-file.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 write_file：
//   input:  { path: string, content: string }
//   output: { content: [{type:'text', text:`Successfully wrote to ${path}`}], structuredContent: { content: text } }
//   annotations: { title:"Write File", readOnlyHint:false, idempotentHint:true, destructiveHint:true, openWorldHint:false }
// （schema 已核对官方 v2026.7.4 源码确认。）
//
// 安全铁律：批准前绝不碰磁盘。下面的顺序是关键：
//   1. 先用不带 create 的 resolveFile 判断文件是否已存在——这一步纯读，无副作用。
//   2. 算好 diff / 展示内容，发确认请求，await 用户结果。
//   3. 只有 approved === true 才会第二次调用 resolveFile（这次带 create:true）、
//      createWritable()、write()、close()——这是整个函数里唯一真正碰磁盘的地方。
// 用户拒绝时直接 return 一个正常 tool result（不 throw、不带 isError），
// 因为"用户不想做这个改动"是正常结果，不是错误。
(function () {
  const NAME = 'write_file';

  const definition = {
    name: NAME,
    title: 'Write File',
    description:
      'Create a new file or completely overwrite an existing file with new content. ' +
      '写入前会弹出 diff 确认框，用户批准后才真正写盘；用户拒绝会返回正常结果（不是错误），文件不会被修改。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的文件路径' },
        content: { type: 'string', description: '要写入的完整文件内容' }
      },
      required: ['path', 'content']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: {
      title: 'Write File',
      readOnlyHint: false,
      idempotentHint: true,
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

    // 第一步：只读，判断文件是否已存在。不带 create，绝不碰磁盘。
    let oldContent = null;
    let isNew = true;
    let conflictWarning = null;
    try {
      const existingHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, path);
      const existingFile = await existingHandle.getFile();
      oldContent = await existingFile.text();
      isNew = false;
      // 写前冲突检测（工具增强批次 v2 ③，只在覆盖分支检查——新建文件没有"陈旧基线"一说）。
      conflictWarning = self.ClaudefsCore.fs.readTracker.checkConflict(path, existingFile.lastModified);
    } catch (e) {
      if (e && e.name === 'NotFoundError') {
        isNew = true;
      } else {
        throw e; // 路径校验错误等其它问题，直接抛出，不要当成"文件不存在"
      }
    }

    const confirmPayload = isNew
      ? { kind: 'write-new', path, title: `新建文件: ${path}`, fullContent: content }
      : {
          kind: 'write-overwrite',
          path,
          title: `覆盖文件: ${path}`,
          diffLines: self.ClaudefsCore.diff.computeLineDiff(oldContent, content),
          warning: conflictWarning || undefined
        };

    const { approved } = await self.ClaudefsCore.confirm.requestConfirmation(confirmPayload);
    if (!approved) {
      return { content: [{ type: 'text', text: '用户取消了这次写入，文件未被修改。' }] };
    }

    // 第二步：批准之后才真正碰磁盘，这里第一次可能带 create:true。
    const fileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, path, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    const written = await fileHandle.getFile();
    self.ClaudefsCore.fs.readTracker.recordWrite(path, written.lastModified);

    const text = `Successfully wrote to ${path}`;
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
