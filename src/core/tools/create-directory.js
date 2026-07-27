// core/tools/create-directory.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 create_directory：
//   input:  { path: string }
//   output: { content: [{type:'text', text:`Successfully created directory ${path}`}], structuredContent }
//   annotations: { readOnlyHint:false, idempotentHint:true, destructiveHint:false }
// （schema 已核对官方 v2026.7.4 源码确认：Node 版用 fs.mkdir(path,{recursive:true})，目录
//  已存在时静默成功；这里用 sandbox.resolveDirectory 的 create:true 逐级 getDirectoryHandle
//  达到同样的"递归创建、已存在不报错"效果——File System Access API 的 getDirectoryHandle
//  加 create:true 本身就是这个语义，不需要额外模拟。）
//
// 非 destructive（官方标注 destructiveHint:false），不需要过 diff 确认——只是新建空目录，
// 不覆盖/删除任何已有内容。
(function () {
  const NAME = 'create_directory';

  const definition = {
    name: NAME,
    title: 'Create Directory',
    description:
      'Create a new directory or ensure a directory exists. Can create multiple nested directories ' +
      'in one operation. If the directory already exists, this operation will succeed silently ' +
      '(返回文案会区分 "Successfully created" 与 "already exists"，前者才是真正新建的空目录)。' +
      'Perfect for setting up directory structures for projects or ensuring required paths exist. ' +
      '首次调用会弹出宿主（claude.ai）自己的 tool_approval_gate（点 Always allow 后不再弹）；' +
      '不会弹本产品的 diff 确认层——建空目录没有内容变化可供 diff，产品确认层只用于有内容' +
      '变化的写操作（write_file/edit_file/move_file），这是刻意设计，不是遗漏。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的目录路径，可以是多级嵌套路径' }
      },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: {
      title: 'Create Directory',
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: false
    }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const path = args && args.path;

    // 官方"已存在也算成功"的语义保留（不报错），但文案要如实区分：先不带 create 探测
    // 目录是不是已经存在，再带 create 真正确保它存在。避免调用方把"本来就有旧文件的已有
    // 目录"误判成"刚新建的空目录"。
    let alreadyExists = true;
    try {
      await self.ClaudefsCore.fs.sandbox.resolveDirectory(root, path);
    } catch (e) {
      if (e && e.name === 'NotFoundError') {
        alreadyExists = false;
      } else {
        throw e;
      }
    }

    await self.ClaudefsCore.fs.sandbox.resolveDirectory(root, path, { create: true });

    const text = alreadyExists
      ? `Directory ${path} already exists`
      : `Successfully created directory ${path}`;
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
