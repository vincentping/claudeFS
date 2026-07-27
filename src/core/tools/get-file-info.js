// core/tools/get-file-info.js — 宿主无关。
// 契约对齐官方 @modelcontextprotocol/server-filesystem 的 get_file_info：
//   input:  { path: string }
//   output: 纯文本 "key: value" 逐行（size/created/modified/accessed/isDirectory/isFile/permissions）
//   annotations: { readOnlyHint: true }
// （schema 已核对官方 v2026.7.4 源码确认：字段集合就是这 7 个 key。）
//
// 与官方的刻意差异（浏览器 API 的真实限制，不是遗漏）：File System Access API 不提供
// created 时间、访问时间、权限位，也不提供目录的大小/修改时间——这些字段官方直接读
// Node fs.stat 就有，浏览器里没有对应能力。为了保持返回的字段名和官方一致（Claude 已经
// 熟悉这套 key），拿不到的字段值统一写成"不可用（浏览器 API 不提供）"而
// 不是让整个字段消失，方便 Claude 一眼看出"这是产品限制、不是这个文件本身没有这个数据"。
//
// totalLines 字段：对官方 7 个 key 的**增列**（additive）——不改动官方任何既有字段的
// 名称/语义，输出形状（text 逐行 key: value）不变，不构成"魔改"。动机：read_file_lines /
// replace_lines / insert_lines 都按行号工作，想知道文件总行数之前得先整读一遍；这里流式
// 读取计数（stream() + 逐 chunk 数 "\n"），不整读进内存，保持元信息工具应有的低成本。
// 二进制文件和目录都不统计行数（值为说明文字，风格与 NOT_AVAILABLE 一致）；>5MB 的文件
// 也跳过统计（元信息工具应保持廉价，行数不是它的核心职责，需要精确行数可以用
// read_file_lines 之类会整读的工具）。
(function () {
  const NAME = 'get_file_info';
  const NOT_AVAILABLE = '不可用（浏览器 File System Access API 不提供此信息）';

  // 流式计数换行符，不把整个文件读进内存。返回值是"文件的行数"（按 "\n" 计数，与
  // read_file_lines / replace_lines / grep_files 同一基准）：n 个换行符对应 n+1 行
  // （最后一段哪怕没有结尾换行也算一行；空文件是 1 行空字符串，和 ''.split('\n').length
  // 的语义一致）。
  async function countLines(file) {
    const reader = file.stream().getReader();
    let newlineCount = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let i = 0; i < value.length; i++) {
          if (value[i] === 0x0a) newlineCount++;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return newlineCount + 1;
  }

  const definition = {
    name: NAME,
    title: 'Get File Info',
    description:
      'Retrieve metadata about a file or directory: size, isDirectory, isFile, totalLines, and — for ' +
      'files — last modified time. Perfect for understanding file characteristics without reading the ' +
      'actual content. created/accessed/permissions 字段浏览器 API 不提供，值固定为说明文字（是产品' +
      '限制，不代表这个文件本身缺失这些数据）；目录没有 size/modified（浏览器 API 无法廉价' +
      '获取目录信息，同样返回说明文字）。totalLines（本产品对官方字段集合的增列，不改动官方' +
      '既有字段）：文本文件的总行数，行号基准与 read_file_lines/replace_lines/insert_lines/' +
      'grep_files 一致（按 "\\n" 计数），流式统计不整读文件；二进制文件或目录、以及超过 5MB ' +
      '的文件不统计，值为说明文字。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对已连接文件夹的文件或目录路径' }
      },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: { title: 'Get File Info', readOnlyHint: true, destructiveHint: false }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const path = args && args.path;
    const entry = await self.ClaudefsCore.fs.sandbox.resolveEntry(root, path);

    let info;
    if (entry.kind === 'file') {
      const file = await entry.handle.getFile();
      let totalLines;
      if (file.size > self.ClaudefsCore.fs.limits.MAX_READ_BYTES) {
        totalLines = '文件过大未统计（超过 5MB）';
      } else {
        const binaryReason = await self.ClaudefsCore.fs.binaryDetect.detectBinaryReason(file);
        totalLines = binaryReason ? '二进制文件不统计行数' : await countLines(file);
      }
      info = {
        size: file.size,
        created: NOT_AVAILABLE,
        modified: new Date(file.lastModified).toISOString(),
        accessed: NOT_AVAILABLE,
        isDirectory: false,
        isFile: true,
        permissions: NOT_AVAILABLE,
        totalLines
      };
    } else {
      info = {
        size: NOT_AVAILABLE,
        created: NOT_AVAILABLE,
        modified: NOT_AVAILABLE,
        accessed: NOT_AVAILABLE,
        isDirectory: true,
        isFile: false,
        permissions: NOT_AVAILABLE,
        totalLines: '目录无行数'
      };
    }

    const text = Object.entries(info)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
