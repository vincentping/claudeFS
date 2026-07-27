// core/tools/move-file.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 move_file：
//   input:  { source: string, destination: string }
//   output: { content: [{type:'text', text:`Successfully moved ${source} to ${destination}`}], structuredContent }
//   annotations: { readOnlyHint:false, idempotentHint:false, destructiveHint:true }
// （schema 已核对官方 v2026.7.4 源码确认：官方直接 fs.rename，是原子的元数据操作，不读取
//  文件内容，对文件和目录都能用；description 写"若目标已存在则操作失败"，但代码本身并
//  没有先检查目标是否存在——POSIX 上 fs.rename 对已存在的目标文件通常会静默覆盖。这是
//  官方 description 和实现之间的一处不一致，本产品按 description 里声明的契约（目标存在
//  就拒绝）实现，不照抄这处会静默覆盖的实际行为——见下方安全说明。）
//
// 与官方的两处刻意差异（浏览器场景的真实限制，不是遗漏）：
// 1. **只支持移动文件，不支持移动整个目录**——File System Access API 没有 fs.rename 这种
//    原子操作，只能"复制新位置成功 + 删除源文件"模拟；对目录这么做要递归复制整棵子树，
//    复杂度和中途失败的风险都高得多。官方 description 写的是"Move or rename files and
//    directories"，本产品刻意收窄到只支持文件，源或目标命中一个目录会明确报错，不会尝试
//    一个不可靠的递归实现（TODO.md 未来如有需求可再评估）。
// 2. **有大小上限（5MB，与 read_file 整读同量级）**——"复制"必须先把整个源文件读进内存
//    再写到新位置，不是官方 fs.rename 那种不读内容的元数据操作，超大文件在浏览器里整个
//    读进内存风险更高，故加此限制（官方没有）。
//
// 安全铁律：destructive 操作，写盘前必须过 diff 确认；确认框展示
// "移动: 源路径 → 目标路径"。approved 之后才真正碰磁盘，且顺序是"先写新位置成功、再删除
// 源文件"——万一写入失败，源文件还在，不会两头落空。
(function () {
  const NAME = 'move_file';

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
    title: 'Move File',
    description:
      'Move or rename a file within the connected folder. If the destination already exists, the ' +
      'operation fails (does not overwrite). Only works within allowed directories. ' +
      '本产品的实现只支持文件（不支持整个目录搬移，见文件头注释），且有 5MB 大小上限' +
      '（浏览器里的"移动"需要先把整个文件读进内存再写到新位置，与官方不读内容的原子 ' +
      'rename 不同）。执行前会弹出 diff 确认框，展示"移动: 源路径 → 目标路径"，用户批准' +
      '后才真正搬移；用户拒绝会返回正常结果（不是错误），文件不会被修改。',
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
      title: 'Move File',
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: true
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
      throw new Error(`move_file 暂不支持移动目录（"${source}" 是一个目录），只支持移动单个文件。`);
    }

    const destEntry = await tryResolveEntry(root, destination);
    if (destEntry) {
      throw new Error(`目标已存在: ${destination}，move_file 不会覆盖已存在的目标。`);
    }

    const sourceFile = await sourceEntry.handle.getFile();
    const maxBytes = self.ClaudefsCore.fs.limits.MAX_READ_BYTES;
    if (sourceFile.size > maxBytes) {
      throw new Error(
        `文件太大（${sourceFile.size} 字节），超过 move_file 的上限 ${maxBytes} 字节（浏览器里搬移需要先把整个文件读进内存）。`
      );
    }

    const conflictWarning = self.ClaudefsCore.fs.readTracker.checkConflict(source, sourceFile.lastModified);

    const { approved } = await self.ClaudefsCore.confirm.requestConfirmation({
      kind: 'move',
      path: destination,
      title: `移动文件: ${source} → ${destination}`,
      fullContent: `移动: ${source} → ${destination}`,
      warning: conflictWarning || undefined
    });
    if (!approved) {
      return { content: [{ type: 'text', text: '用户取消了这次移动，文件未被修改。' }] };
    }

    const buffer = await sourceFile.arrayBuffer();
    const destFileHandle = await self.ClaudefsCore.fs.sandbox.resolveFile(root, destination, { create: true });
    const writable = await destFileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();

    await self.ClaudefsCore.fs.sandbox.removeFile(root, source);
    const movedFile = await destFileHandle.getFile();
    self.ClaudefsCore.fs.readTracker.recordWrite(destination, movedFile.lastModified);

    const text = `Successfully moved ${source} to ${destination}`;
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
