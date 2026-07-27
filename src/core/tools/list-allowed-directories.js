// core/tools/list-allowed-directories.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 list_allowed_directories：
//   input:  {}（无参数）
//   output: 纯文本，"Allowed directories:\n" 后每行一个目录路径，包进 structuredContent.content
//   annotations: { title: "List Allowed Directories", readOnlyHint: true }
// （schema 已核对官方 v2026.7.4 源码确认：dist/index.js 里 inputSchema 为空对象，
//  outputSchema 为 { content: string }，官方假设 allowedDirectories 数组非空、
//  没有处理空列表的提示文案。）
//
// 本产品的特殊性（不是照抄官方，是产品化补充）：
// 1. 同一时刻只有一个授权根目录（用户只能 showDirectoryPicker 选一个），列表最多一项。
// 2. 未连接目录（getCurrentHandle() 返回 null）是合法状态，不是错误——这个工具本身
//    就是查询授权状态，跟需要目录才能干活的读写工具不同，不 throw，正常返回说明文字。
// 3. FileSystemDirectoryHandle 只暴露 .name（浏览器隐私限制，拿不到完整系统路径），
//    返回里显式说明这一点，避免 Claude 把目录名误当成绝对路径使用。
(function () {
  const NAME = 'list_allowed_directories';

  const definition = {
    name: NAME,
    title: 'List Allowed Directories',
    description:
      '返回当前已授权访问的目录列表（本产品同一时刻最多一个）。子目录同样可访问。' +
      '未连接任何文件夹时返回说明文字而不是报错。出于浏览器隐私限制，只能拿到目录名，' +
      '拿不到完整系统路径。',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: { title: 'List Allowed Directories', readOnlyHint: true, destructiveHint: false }
  };

  async function handler() {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();

    const text = root
      ? `Allowed directories:\n${root.name}\n（浏览器出于隐私限制不提供完整系统路径，这里的名称仅为目录名，子目录同样可访问）`
      : '当前未授权任何目录，请先连接文件夹。';

    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
