// core/tools/directory-tree.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 directory_tree：
//   input:  { path: string, excludePatterns?: string[] }
//   output: { content: [{type:'text', text: JSON.stringify(tree, null, 2)}], structuredContent: { content: text } }
//   tree 形状: [{ name, type: 'file'|'directory', children?: [...] }]
// （schema 已核对官方 v2026.7.4 源码确认；官方用 npm 包 minimatch 做 excludePatterns，
//  本项目没有构建步骤，用 core/fs/glob.js 自己写的等价匹配。）
//
// ⚠️ 与官方的刻意差异（DESIGN.md §3.1 明确要求，不是遗漏）：官方没有深度/条目上限、也不
// 默认忽略任何目录，纯靠调用方传 excludePatterns。浏览器场景下一个大仓库（比如带
// node_modules 的项目）很容易撑爆返回内容或让递归卡很久，所以本产品默认：
//   - 始终忽略 node_modules、.git（在调用方传的 excludePatterns 基础上叠加，不是替代）
//   - 深度上限 MAX_DEPTH、条目总数上限 MAX_ENTRIES，超限时插入一个 type:'truncated' 的
//     提示节点，而不是静默截断——避免 Claude 误以为目录就这么点内容。
//
// 已知局限（docs/archives/20260714_review_1.md #10，接受，不改）：MAX_ENTRIES 是深度优先遍历下的全局计数，
// 如果排在前面的某个分支本身很深/很大，可能在还没轮到后面的兄弟目录/文件之前就把预算
// 耗尽——这种情况下被跳过的兄弟目录不会出现在结果里，也不会有 truncated 节点单独指出
// "这些兄弟目录整个没展开"，只有耗尽预算那个分支内部会出现 truncated 节点。即"某处出现
// 了 truncated 节点"不代表"只有这一处内容被截断"。
(function () {
  const DEFAULT_EXCLUDES = ['node_modules', '.git'];
  const MAX_DEPTH = 6;
  const MAX_ENTRIES = 2000;

  const definition = {
    name: 'directory_tree',
    title: 'Directory Tree',
    description:
      '递归列出已连接文件夹内指定路径下的目录树（JSON 形式）。默认忽略 node_modules、.git，并对深度和条目数做了上限保护。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的路径，"." 表示根目录本身' },
        excludePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: '额外要排除的 glob 模式（在默认忽略 node_modules/.git 之外）'
        }
      },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: { title: 'Directory Tree', readOnlyHint: true, destructiveHint: false }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const path = args && typeof args.path === 'string' ? args.path : '.';
    const startDir = await self.ClaudefsCore.fs.sandbox.resolveDirectory(root, path);
    const userExcludes = args && Array.isArray(args.excludePatterns) ? args.excludePatterns : [];
    const excludePatterns = DEFAULT_EXCLUDES.concat(userExcludes);

    let entryCount = 0;
    let entryLimitHit = false;

    async function walk(dirHandle, relativePath, depth) {
      const children = [];
      for await (const [name, entryHandle] of dirHandle.entries()) {
        if (entryLimitHit) break;

        const entryRelPath = relativePath ? `${relativePath}/${name}` : name;
        if (self.ClaudefsCore.fs.glob.matchesAny(entryRelPath, excludePatterns)) continue;

        entryCount++;
        if (entryCount > MAX_ENTRIES) {
          entryLimitHit = true;
          children.push({ name: `... (已达到条目上限 ${MAX_ENTRIES}，后续内容已省略)`, type: 'truncated' });
          break;
        }

        // 只在写入给 Claude 看的 name 字段时转义（escapeSpecialChars，见 list-directory.js
        // 顶部注释 / D-reply）；entryRelPath 传去下一层递归和 glob 匹配必须用原始 name，
        // 不能转义——否则子目录的排除规则会拿转义后的假路径去匹配，永远匹配不上。
        const displayName = self.ClaudefsCore.fs.nameEscape.escapeSpecialChars(name);
        if (entryHandle.kind === 'directory') {
          if (depth >= MAX_DEPTH) {
            children.push({
              name: displayName,
              type: 'directory',
              children: [{ name: `... (已达到深度上限 ${MAX_DEPTH}，未继续展开)`, type: 'truncated' }]
            });
          } else {
            children.push({
              name: displayName,
              type: 'directory',
              children: await walk(entryHandle, entryRelPath, depth + 1)
            });
          }
        } else {
          children.push({ name: displayName, type: 'file' });
        }
      }
      return children;
    }

    const treeData = await walk(startDir, '', 0);
    const text = JSON.stringify(treeData, null, 2);
    return {
      content: [{ type: 'text', text }],
      structuredContent: { content: text }
    };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools.directory_tree = { definition, handler };
})();
