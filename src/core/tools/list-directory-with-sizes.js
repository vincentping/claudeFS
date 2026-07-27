// core/tools/list-directory-with-sizes.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 list_directory_with_sizes：
//   input:  { path: string, sortBy?: 'name'|'size'（默认 'name'） }
//   output: 纯文本，每行 "[DIR]/[FILE] name(补齐30列) 大小(右对齐10列，目录留空)"，
//           末尾附 "Total: X files, Y directories" 和 "Combined size: Z" 两行汇总
//   annotations: { readOnlyHint: true }
// （schema 已核对官方 v2026.7.4 源码确认：目录不计入大小——大小列留空、汇总里目录按 0
//  计入 combined size；这对本产品刚好是个巧合的便利，因为 FileSystemDirectoryHandle 本身
//  就没有廉价获取递归大小的 API，不用像官方那样特意跳过，天然一致，不算刻意背离。
//  formatSize 的单位换算是纯数学工具函数（不涉及文件 I/O），照抄官方实现以保证输出格式和
//  桌面版一致——官方实现里不可直接复用的部分是 Node fs 相关代码，这个纯数学函数不属于那类。）
(function () {
  const NAME = 'list_directory_with_sizes';

  function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i < 0 || i === 0) return `${bytes} ${units[0]}`;
    const unitIndex = Math.min(i, units.length - 1);
    return `${(bytes / Math.pow(1024, unitIndex)).toFixed(2)} ${units[unitIndex]}`;
  }

  const definition = {
    name: NAME,
    title: 'List Directory with Sizes',
    description:
      'Get a detailed listing of all files and directories in a specified path, including sizes. ' +
      'Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. ' +
      '目录不显示大小（浏览器 API 无法廉价获取目录递归大小），也不计入 Combined size 汇总，' +
      '与官方桌面版行为一致。sortBy 为 "size" 时按大小降序排列，默认 "name" 按名称排列。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的路径' },
        sortBy: { type: 'string', enum: ['name', 'size'], description: '排序方式，默认 "name"' }
      },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: { title: 'List Directory with Sizes', readOnlyHint: true, destructiveHint: false }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const path = args && typeof args.path === 'string' ? args.path : '.';
    const sortBy = args && args.sortBy === 'size' ? 'size' : 'name';
    const dirHandle = await self.ClaudefsCore.fs.sandbox.resolveDirectory(root, path);

    const entries = [];
    for await (const [name, entryHandle] of dirHandle.entries()) {
      // 展示前转义 WSL 私有使用区字符，见 list-directory.js 顶部注释 / D-reply。
      const displayName = self.ClaudefsCore.fs.nameEscape.escapeSpecialChars(name);
      if (entryHandle.kind === 'directory') {
        entries.push({ name: displayName, isDirectory: true, size: 0 });
      } else {
        const file = await entryHandle.getFile();
        entries.push({ name: displayName, isDirectory: false, size: file.size });
      }
    }

    entries.sort((a, b) => (sortBy === 'size' ? b.size - a.size : a.name.localeCompare(b.name)));

    const lines = entries.map(
      (e) => `${e.isDirectory ? '[DIR]' : '[FILE]'} ${e.name.padEnd(30)} ${e.isDirectory ? '' : formatSize(e.size).padStart(10)}`
    );
    const totalFiles = entries.filter((e) => !e.isDirectory).length;
    const totalDirs = entries.filter((e) => e.isDirectory).length;
    const totalSize = entries.reduce((sum, e) => sum + (e.isDirectory ? 0 : e.size), 0);

    const text = lines
      .concat(['', `Total: ${totalFiles} files, ${totalDirs} directories`, `Combined size: ${formatSize(totalSize)}`])
      .join('\n');

    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
