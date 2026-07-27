// core/tools/rm-empty-dir.js — 宿主无关。
// 扩展工具（官方无对应，见 delete-file.js 顶部注释同一立项背景）。
//
// ⚠️ 硬约束（不是"暂未实现"，是刻意锁死的产品边界）：
// 只删**空**目录，绝不递归删非空目录——一句调用连根删掉一整棵子树是一步不可逆的操作，
// 用户对"这目录里到底有啥"往往没有准确预期，只显示目录名的确认等于盲签。故本工具自己
// 先枚举目录内容判断是否为空，非空一律报错拒绝（不依赖浏览器 removeEntry 对非空目录会
// 报错这件事来兜底——我们要在报错信息里说清楚"含 N 个条目"，且要在弹确认框之前就挡掉，
// 不能等到批准后写盘那一步才失败）。将来即使做了自动接受模式，递归删也永不得自动接受。
(function () {
  const NAME = 'rm_empty_dir';

  const definition = {
    name: NAME,
    title: 'Remove Empty Directory',
    description:
      '删除已连接文件夹内的一个**空**目录（本产品扩展工具，官方无对应）。' +
      '只删空目录：会先检查目录内容，非空则报错拒绝并在错误信息里说明含多少个条目，绝不递归' +
      '删除非空目录的内容。执行前会弹出确认框展示"将删除空目录：目录名"，用户批准后才真正' +
      '删除；用户拒绝会返回正常结果（不是错误），目录不会被删除。若目标是文件而不是目录，' +
      '会报错（删文件请用 delete_file）。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的目录路径' }
      },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: {
      title: 'Remove Empty Directory',
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
    if (entry.kind !== 'directory') {
      throw new Error(`rm_empty_dir 只能删除目录（"${path}" 是一个文件），删文件请用 delete_file。`);
    }

    // 报错信息里带条目数，方便 Claude 判断非空的严重程度，故数完
    // 整个目录（不是撞到第一个就停）——空目录场景（真正会走到确认框的那条路径）本身没有
    // 条目可数，这个循环代价为零；非空场景才需要数完，但那条路径本来就要报错中止，不追求
    // 极致省一次遍历。
    let entryCount = 0;
    for await (const _entry of entry.handle.entries()) {
      entryCount++;
    }
    if (entryCount > 0) {
      throw new Error(
        `目录非空、含 ${entryCount} 个条目: ${path}，rm_empty_dir 只删空目录，绝不递归删除非空目录的内容。`
      );
    }

    const { approved } = await self.ClaudefsCore.confirm.requestConfirmation({
      kind: 'delete-dir',
      path,
      title: `删除空目录: ${path}`,
      fullContent: `将删除空目录：${path}`
    });
    if (!approved) {
      return { content: [{ type: 'text', text: '用户取消了这次删除，目录未被修改。' }] };
    }

    await self.ClaudefsCore.fs.sandbox.removeDirectory(root, path);

    const text = `Successfully removed empty directory ${path}`;
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
