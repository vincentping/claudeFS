// core/tools/copy-file.js — 宿主无关。
// 扩展工具（官方无对应）：现状"复制文件"只能靠 Claude 把内容读进 context 再写回，
// 烧 token、还受 read_file 的 5MB 整读上限。copy_file 在扩展内部直接流式直拷，内容完全
// 不经过 context。
//
// 与 move_file 的差异（两者都在文件头注释说明，互相参照）：move_file 必须先把整个源文件
// 读进内存（arrayBuffer()）再写到新位置，是因为它要保证"写成功后才删源"这个顺序，中途
// 用一个持有整个内容的 buffer 天然满足；copy_file 没有"删源"这一步，可以用
// sourceFile.stream().pipeTo(destWritable) 边读边写、不整体持有内容，因此不像 move_file
// 那样设 5MB 上限。
//
// 只支持文件（源是目录报错，措辞对齐 move_file）；目标已存在报错不覆盖（同样对齐
// move_file，复制不应该是隐式覆盖操作）。
(function () {
  const NAME = 'copy_file';

  async function tryResolveEntry(root, path) {
    try {
      return await self.ClaudefsCore.fs.sandbox.resolveEntry(root, path);
    } catch (e) {
      if (e && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  const definition = {
    name: NAME,
    title: 'Copy File',
    description:
      'Copy a file within the connected folder. If the destination already exists, the operation ' +
      'fails (does not overwrite). Only works on files, not directories. ' +
      '本产品扩展工具，官方无对应。与 move_file 的关键差异：本工具流式' +
      '直拷（sourceFile.stream().pipeTo），内容完全不经过 Claude 的 context、不整读进内存，' +
      '因此**没有 5MB 大小上限**（move_file 因为要保证"先写成后删源"的顺序，必须整读，故有' +
      '上限）。执行前会弹出确认框展示"复制: 源路径 → 目标路径"，用户批准后才真正复制；用户' +
      '拒绝会返回正常结果（不是错误），不会创建任何文件。复制中途失败会尽力删除写了一半的' +
      '目标文件。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '相对已连接文件夹的源文件路径' },
        destination: { type: 'string', description: '相对已连接文件夹的目标文件路径，目标必须不存在（不会覆盖）' }
      },
      required: ['source', 'destination']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: {
      title: 'Copy File',
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false
    }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const source = args && args.source;
    const destination = args && args.destination;
    if (!source || !destination) {
      throw new Error('source 和 destination 都不能为空');
    }

    const sourceEntry = await self.ClaudefsCore.fs.sandbox.resolveEntry(root, source);
    if (sourceEntry.kind !== 'file') {
      throw new Error(`copy_file 暂不支持复制目录（"${source}" 是一个目录），只支持复制单个文件。`);
    }

    const destEntry = await tryResolveEntry(root, destination);
    if (destEntry) {
      throw new Error(`目标已存在: ${destination}，copy_file 不会覆盖已存在的目标。`);
    }

    const { approved } = await self.ClaudefsCore.confirm.requestConfirmation({
      kind: 'copy',
      path: destination,
      title: `Copy: ${source} → ${destination}`,
      fullContent: `Copy: ${source} → ${destination}`
    });
    if (!approved) {
      return { content: [{ type: 'text', text: '用户取消了这次复制，未创建任何文件。' }] };
    }

    const destFileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, destination, { create: true });
    let writable;
    try {
      const sourceFile = await sourceEntry.handle.getFile();
      writable = await destFileHandle.createWritable();
      await sourceFile.stream().pipeTo(writable);
    } catch (e) {
      // 尽力清理写了一半的目标文件；清理本身失败不掩盖原始错误。
      try {
        await self.ClaudefsCore.fs.sandbox.removeFile(root, destination);
      } catch (cleanupErr) {
        throw new Error(`复制失败: ${e.message}（清理未完成的目标文件也失败: ${cleanupErr.message}，目标可能残留不完整内容）`);
      }
      throw new Error(`复制失败: ${e.message}（已清理未完成的目标文件）`);
    }

    const text = `Successfully copied ${source} to ${destination}`;
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
