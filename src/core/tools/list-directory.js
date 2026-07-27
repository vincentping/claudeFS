// core/tools/list-directory.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 list_directory：
//   input:  { path: string }
//   output: { content: [{type:'text', text}], structuredContent: { content: text } }，
//     text 是纯文本，每行 "[DIR] name" 或 "[FILE] name"，用 \n 连接；空目录返回空字符串
//     （官方就是这么处理的，没有占位文字）
//   annotations: { title: "List Directory", readOnlyHint: true, destructiveHint: false }
// （schema 已核对官方 v2026.7.4 源码确认，不是凭记忆猜的；此前本文件裸返回字符串、未包
// structuredContent，与本注释描述的契约不一致，已修正对齐。）
//
// name 在展示前统一过 core/fs/name-escape.js 的 escapeSpecialChars——WSL2 环境下文件名
// 可能含 Unicode 私有使用区字符（Windows 非法字符 \ : 等的编码），这些字符大多不可见，
// 直接输出会让 Claude 看到"缺字符"的名字，回传时构造出的路径找不到文件。转义后的名字
// Claude 可以照抄回 path 参数，sandbox.js 的 splitPath 会自动反转义。详见
// docs/archives/20260715_review_2_reply.md。
(function () {
  const NAME = 'list_directory';

  const definition = {
    name: NAME,
    title: 'List Directory',
    description:
      '列出已连接文件夹内指定路径下的文件和子目录。path 是相对于已授权根目录的相对路径，用 "." 表示根目录本身。' +
      '空目录返回空字符串（不是错误，也不会有额外提示文字）。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的路径，"." 表示根目录本身' }
      },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: { title: 'List Directory', readOnlyHint: true, destructiveHint: false }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const path = args && typeof args.path === 'string' ? args.path : '.';
    const dirHandle = await self.ClaudefsCore.fs.sandbox.resolveDirectory(root, path);

    const lines = [];
    for await (const [name, entryHandle] of dirHandle.entries()) {
      const displayName = self.ClaudefsCore.fs.nameEscape.escapeSpecialChars(name);
      lines.push(`${entryHandle.kind === 'directory' ? '[DIR]' : '[FILE]'} ${displayName}`);
    }
    const text = lines.join('\n');
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
