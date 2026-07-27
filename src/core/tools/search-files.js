// core/tools/search-files.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 search_files：
//   input:  { path: string, pattern: string, excludePatterns?: string[] }
//   output: 纯文本，每行一个匹配路径；0 匹配返回字面量 "No matches found"（不翻译，和官方
//           返回值保持一致，避免误导按字符串比对官方输出的调用方）
//   annotations: { readOnlyHint: true }
// （schema 已核对官方 v2026.7.4 源码确认：pattern/excludePatterns 都是用 minimatch 对
//  "相对于 path 参数的相对路径"做锚定整段匹配——不带通配符的字面量必须整段等于该相对路径
//  才算命中，想匹配任意深度需要自己传 "**/文件名"（已用 minimatch 实测验证这一行为，见
//  提交说明）。这一点和 directory_tree 的 excludePatterns 不同（那边为不带通配符的字面量
//  做了"任意深度都算命中"的兜底，见 core/fs/glob.js 的 matchesAny）——是官方两个工具本身
//  实现方式不同，如实对齐各自行为，不强行统一成一套。）
//
// 与官方的两处刻意差异（浏览器场景的必要妥协，不是遗漏）：
//   1. 返回的匹配路径是相对已连接文件夹根目录的路径，不是官方的系统绝对路径——浏览器
//      沙箱模型下没有"绝对路径"这个概念（同 list_allowed_directories 的隐私限制）。
//   2. 官方没有遍历深度/条目上限（Node fs 直接跑），浏览器里为避免大目录卡死标签页，复用
//      与 directory_tree 同量级的深度/条目上限，超限会在结果文本末尾追加明确提示，不静默
//      丢弃（同 D11 的取舍精神）。
(function () {
  const NAME = 'search_files';
  const MAX_DEPTH = 6;
  const MAX_ENTRIES = 2000;

  const definition = {
    name: NAME,
    title: 'Search Files',
    description:
      "Recursively search for files and directories matching a pattern. " +
      "只按文件名/路径搜索；按文件内容搜索请用 grep_files。" + ' ' +
      "The patterns should be glob-style patterns that match paths relative to the working directory. " +
      "Use pattern like '*.ext' to match files in current directory, and '**/*.ext' to match files in all subdirectories. " +
      "Great for finding files when you don't know their exact location. " +
      '返回的是相对已连接文件夹根目录的路径（浏览器沙箱模型下没有系统绝对路径概念）。' +
      '不带通配符的字面量 pattern 必须与整段相对路径完全一致才算命中（比如要匹配任意深度' +
      '下名为 "foo.txt" 的文件，需要传 "**/foo.txt"，和官方 minimatch 行为一致）。遍历有' +
      '深度/条目上限（浏览器安全默认，官方没有），超限会在结果文本末尾明确提示，不静默' +
      '丢弃。0 个匹配返回 "No matches found"。' +
      '本工具不默认排除 node_modules/.git（与 grep_files/directory_tree 不同，那两个工具' +
      '默认排除）；要跳过它们请在 excludePatterns 里显式传入，例如 ["**/node_modules", ' +
      '"**/.git"]（已实测确认能命中这两个目录条目本身，从而跳过整棵子树；注意 ' +
      '"**/node_modules/**" 这类写法命中不了目录条目本身，不会生效）。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '起始目录，相对已连接文件夹根目录' },
        pattern: { type: 'string', description: 'glob 模式，匹配相对 path 的路径（见 description 的匹配规则说明）' },
        excludePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: '要排除的 glob 模式列表（同样是整段锚定匹配，不做任意深度兜底）'
        }
      },
      required: ['path', 'pattern']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: { title: 'Search Files', readOnlyHint: true, destructiveHint: false }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const startPath = args && typeof args.path === 'string' ? args.path : '.';
    const pattern = args && args.pattern;
    if (!pattern) {
      throw new Error('pattern 不能为空');
    }
    const excludePatterns = args && Array.isArray(args.excludePatterns) ? args.excludePatterns : [];

    const startDir = await self.ClaudefsCore.fs.sandbox.resolveDirectory(root, startPath);

    const results = [];
    let entryCount = 0;
    let entryLimitHit = false;
    let depthLimitHit = false;

    function toRootRelative(entryRelPath) {
      if (!startPath || startPath === '.') return entryRelPath;
      return `${startPath}/${entryRelPath}`;
    }

    async function walk(dirHandle, relativePath, depth) {
      for await (const [name, entryHandle] of dirHandle.entries()) {
        if (entryLimitHit) return;

        const entryRelPath = relativePath ? `${relativePath}/${name}` : name;

        const excluded = excludePatterns.some((p) => self.ClaudefsCore.fs.glob.matchGlob(entryRelPath, p));
        if (excluded) continue;

        entryCount++;
        if (entryCount > MAX_ENTRIES) {
          entryLimitHit = true;
          return;
        }

        if (self.ClaudefsCore.fs.glob.matchGlob(entryRelPath, pattern)) {
          // 结果路径写入前转义 WSL 私有使用区字符（见 list-directory.js 顶部注释 /
          // D-reply）；匹配/递归全程用的是上面未转义的 entryRelPath，只在最终展示给
          // Claude 的这一步转义，不影响 glob 匹配和目录遍历。
          results.push(self.ClaudefsCore.fs.nameEscape.escapeSpecialChars(toRootRelative(entryRelPath)));
        }

        if (entryHandle.kind === 'directory') {
          if (depth < MAX_DEPTH) {
            await walk(entryHandle, entryRelPath, depth + 1);
          } else {
            depthLimitHit = true;
          }
        }
      }
    }

    await walk(startDir, '', 0);

    const truncated = entryLimitHit || depthLimitHit;
    const truncationNote = truncated
      ? `\n\n（已达到遍历深度/条目上限（${MAX_ENTRIES} 条 / 深度 ${MAX_DEPTH} 层），结果可能不完整）`
      : '';

    const text = results.length > 0 ? results.join('\n') + truncationNote : `No matches found${truncationNote}`;

    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
