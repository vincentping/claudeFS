// core/tools/delete-file.js — 宿主无关。
// 扩展工具（官方 server-filesystem 无对应；官方能 move、能 write 覆盖，但没有纯删除工具，
// 是官方有意的保守立场——删除不可逆、风险收益比差）。本产品在实战中两次撞到删除需求
// （删测试目录、清理垃圾文件）后补上，按危险度分级只做单文件/空目录两种删除，绝不做
// 递归删除整棵目录树。
//
// 只删单个文件，不处理目录（目录删除是 rm_empty_dir 的职责，见该文件）。
// 安全铁律：destructive 操作，写盘前必须过 diff 确认；确认框展示
// "将删除：文件名 + 大小"。approved 之后才真正调用 removeFile 碰磁盘。
(function () {
  const NAME = 'delete_file';

  const definition = {
    name: NAME,
    title: 'Delete File',
    description:
      '删除已连接文件夹内的单个文件（本产品扩展工具，官方 server-filesystem 无对应——官方 ' +
      '只有 move/write 覆盖，没有纯删除，是官方有意的保守立场）。只能删' +
      '文件，不能删目录（路径指向目录会报错，删空目录请用 rm_empty_dir）。执行前会弹出确认框' +
      '展示"将删除：文件名 + 大小"，用户批准后才真正删除；用户拒绝会返回正常结果（不是错误），' +
      '文件不会被删除。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的文件路径' }
      },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: {
      title: 'Delete File',
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
    if (!path) {
      throw new Error('path 不能为空');
    }

    const entry = await self.ClaudefsCore.fs.sandbox.resolveEntry(root, path);
    if (entry.kind !== 'file') {
      throw new Error(`delete_file 只能删除文件（"${path}" 是一个目录），删空目录请用 rm_empty_dir。`);
    }

    const file = await entry.handle.getFile();
    const conflictWarning = self.ClaudefsCore.fs.readTracker.checkConflict(path, file.lastModified);

    const { approved } = await self.ClaudefsCore.confirm.requestConfirmation({
      kind: 'delete-file',
      path,
      title: `删除文件: ${path}`,
      fullContent: `将删除：${path}（${file.size} 字节）`,
      warning: conflictWarning || undefined
    });
    if (!approved) {
      return { content: [{ type: 'text', text: '用户取消了这次删除，文件未被修改。' }] };
    }

    await self.ClaudefsCore.fs.sandbox.removeFile(root, path);

    const text = `Successfully deleted ${path}`;
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
