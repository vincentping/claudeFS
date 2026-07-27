// core/tools/grep-files.js — 宿主无关。
// 扩展工具（官方无对应；D12 立项理由：官方 search_files 只搜文件名，浏览器场景 Claude
// 没有真 grep，按内容搜索是真实痛点）。契约完全自定义，没有官方参照，边界行为定死在
// 这里和下面的 description 里（D12 原则 2：Claude 对扩展工具没有训练熟悉度，description
// 必须自我解释完整）。
//
// 边界行为（今天定死的规格）：
//   - pattern 默认字面量子串匹配；regex:true 才把 pattern 当正则解释，无效正则报错。
//   - 每行最多报告一处命中（一行内多次命中只算一条结果，和 grep -n 按行输出一致）。
//   - 命中行过长时只保留匹配点前后各约 40 字符，两端用 "..." 省略，避免整行塞爆结果。
//   - 结果数达到上限会停止搜索，返回文本末尾明确写"已截断，至少找到 N 处"，绝不静默丢弃。
//   - 0 命中返回明确的"未找到匹配"文字，不是空字符串。
//   - 复用 core/fs/binary-detect.js 跳过二进制文件；复用 core/fs/default-excludes.js
//     默认忽略 node_modules、.git。
//   - 行号从 1 开始，按 '\n' 计数（不用 /\r?\n/），与 read_file_lines、edit_file 报错里的
//     行号同一基准——三者可以配合使用，见 scripts/tests 里的跨工具一致性用例。
//   - glob 分流规则（2026-07-15，docs/archives/20260715_review_1.md P1a 修正）：pattern 不含 "/"
//     按 basename 任意深度匹配（"*.md" 搜全项目所有 .md，不是只搜根目录）；含 "/" 按完整
//     相对路径锚定匹配（"src/*.js" 只命中 src 这一层，"**/*.md" 显式任意深度）。分流只看
//     是否含 "/"，不按通配符种类（*/**/?）分叉。这是 grep_files 自己的契约（D12 扩展工具，
//     不必跟随 search_files 的路径锚定语义）。
//   - path 可以指向单个文件（P1b 修正）：此时只搜这一个文件，glob 不生效（和 ripgrep 一致，
//     显式点名的文件不受 --glob 过滤）；path 指向目录时才递归遍历、glob 才生效。
(function () {
  const NAME = 'grep_files';
  const MAX_RESULTS = 200; // 命中结果上限
  const MAX_FILES_SCANNED = 5000; // 遍历文件数量安全阀，避免超大仓库卡死标签页
  const MAX_DEPTH = 30; // 比 directory_tree 的 6 宽松很多：grep 返回的是扁平结果不是树，
  // 用户常见的深层 src 目录结构很容易超过 6 层，这里只防真正的病态深度/遍历失控
  const LINE_CONTEXT_CHARS = 40; // 命中行过长时，匹配点前后各保留的字符数

  // path 是单个文件时，用它作为结果里的相对路径展示；标准化成和 walk() 拼出来的
  // entryRelPath 同样的形状（正斜杠分隔、无前导 "./"），保证输出格式一致。
  function normalizePath(path) {
    return String(path)
      .replace(/\\/g, '/')
      .split('/')
      .filter((seg) => seg !== '' && seg !== '.')
      .join('/');
  }

  function truncateLine(line, matchIndex, matchLength) {
    const start = Math.max(0, matchIndex - LINE_CONTEXT_CHARS);
    const end = Math.min(line.length, matchIndex + matchLength + LINE_CONTEXT_CHARS);
    let display = line.slice(start, end);
    if (start > 0) display = '...' + display;
    if (end < line.length) display = display + '...';
    return display;
  }

  // 返回一个 (line) => {index, length} | null 的匹配函数。regex 模式下用 RegExp#exec 拿
  // 第一个匹配；字面量模式下用 indexOf，区分大小写与否分别处理。
  function makeLineMatcher(pattern, useRegex, caseSensitive) {
    if (useRegex) {
      let re;
      try {
        re = new RegExp(pattern, caseSensitive ? '' : 'i');
      } catch (e) {
        throw new Error(`正则表达式无效: ${e.message}`);
      }
      return (line) => {
        const m = re.exec(line);
        return m ? { index: m.index, length: m[0].length || 1 } : null;
      };
    }
    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    return (line) => {
      const haystack = caseSensitive ? line : line.toLowerCase();
      const idx = haystack.indexOf(needle);
      return idx === -1 ? null : { index: idx, length: pattern.length };
    };
  }

  const definition = {
    name: NAME,
    title: 'Grep Files',
    description:
      '按内容递归搜索已连接文件夹内的文本文件，返回命中所在的文件路径、行号和行内容' +
      '（类似命令行 grep -n 的浏览器版；本产品扩展工具，官方 14 个工具没有按内容搜索的能力，' +
      '官方 search_files 只搜文件名）。pattern 默认按字面量子串匹配（安全，不怕括号等正则' +
      '元字符）；传 regex:true 才把 pattern 当正则表达式解释，正则无效会报错说明原因。' +
      'case_sensitive 默认 true（区分大小写）。可选 glob 过滤要搜索的文件：不含 "/" 的 ' +
      'pattern（如 "*.md"）按文件名在任意深度匹配（跨全部子目录搜索该文件名/扩展名，和 ' +
      'ripgrep --glob 的直觉一致，不是只搜根目录）；含 "/" 的 pattern（如 "src/*.js"）按相对' +
      '路径锚定匹配到该层级，也可以显式写 "**/*.md" 表达"任意深度"；不填 glob 则搜索全部' +
      '非二进制文件。path 指定起始位置，相对已连接文件夹根目录：可以是目录（递归搜索该目录' +
      '下所有文件，默认 "." 表示整个已连接目录），也可以直接指向单个文件（只搜这一个文件；' +
      '此时 glob 参数不生效，因为已经明确点名要搜哪个文件）。二进制文件自动跳过；默认忽略' +
      'node_modules、.git（与 directory_tree 的默认忽略一致）。每行最多报告一处命中（一行内' +
      '出现多次只算一条结果）；命中行过长时只保留匹配点前后各约 40 个字符，两端用 "..." ' +
      `省略。结果数达到上限 ${MAX_RESULTS} 条会停止搜索，并在返回文本末尾明确写"已截断，至少` +
      '找到 N 处"，绝不静默丢弃；没有任何命中会返回明确的"未找到匹配"文字，不是空字符串。' +
      '行号从 1 开始，和 read_file_lines、edit_file 报错里的行号使用同一基准，可以配套使用' +
      '（grep_files 定位命中位置 → read_file_lines 按行区间精读上下文 → edit_file 精确修改）。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '要搜索的内容；默认字面量匹配，regex:true 时按正则解释' },
        path: { type: 'string', description: '起始位置，相对已连接文件夹根目录，默认 "."（整个已连接目录）；可以是目录（递归搜索）也可以直接指向单个文件（只搜这一个文件，此时 glob 不生效）' },
        glob: { type: 'string', description: '可选过滤要搜索的文件：不含 "/" 按文件名任意深度匹配（如 "*.md" 搜全项目所有 .md），含 "/" 按相对路径锚定匹配（如 "src/*.js" 只搜 src 层，也可写 "**/*.md" 显式任意深度）；不填则搜索全部非二进制文件' },
        regex: { type: 'boolean', description: '为 true 时把 pattern 当正则表达式解释，默认为 false（字面量子串匹配）' },
        case_sensitive: { type: 'boolean', description: '是否区分大小写，默认为 true' }
      },
      required: ['pattern']
    },
    outputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content']
    },
    annotations: { title: 'Grep Files', readOnlyHint: true, destructiveHint: false }
  };

  async function handler(args) {
    const root = self.ClaudefsCore.fs.handleStore.getCurrentHandle();
    if (!root) {
      throw new Error('尚未连接文件夹，请先在页面右下角点击"连接文件夹"完成授权。');
    }

    const pattern = args && args.pattern;
    if (!pattern) {
      throw new Error('pattern 不能为空');
    }
    const useRegex = !!(args && args.regex);
    const caseSensitive = !(args && args.case_sensitive === false);
    const glob = args && args.glob;
    const startPath = args && typeof args.path === 'string' ? args.path : '.';

    const matchLine = makeLineMatcher(pattern, useRegex, caseSensitive);
    const startEntry = await self.ClaudefsCore.fs.sandbox.resolveEntry(root, startPath);
    const excludePatterns = self.ClaudefsCore.fs.defaultExcludes;

    const results = [];
    let resultsTruncated = false;
    let filesScanned = 0;
    let scanTruncated = false;
    let skippedBinary = 0;
    let skippedTooLarge = 0;

    async function scanFile(fileHandle, relPath) {
      const file = await fileHandle.getFile();
      if (file.size > self.ClaudefsCore.fs.limits.MAX_READ_BYTES) {
        skippedTooLarge++;
        return;
      }
      const reason = await self.ClaudefsCore.fs.binaryDetect.detectBinaryReason(file);
      if (reason) {
        skippedBinary++;
        return;
      }
      const text = await file.text();
      const lines = text.split('\n');
      let hasMatch = false;
      for (let i = 0; i < lines.length; i++) {
        if (resultsTruncated) break;
        const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
        const m = matchLine(line);
        if (!m) continue;
        hasMatch = true;
        // relPath 展示前转义 WSL 私有使用区字符（见 list-directory.js 顶部注释 /
        // docs/archives/20260715_review_2_reply.md）；匹配/遍历全程用的是原始 relPath，只在这里
        // 写入结果文本时转义。
        const displayPath = self.ClaudefsCore.fs.nameEscape.escapeSpecialChars(relPath);
        results.push(`${displayPath}:${i + 1}: ${truncateLine(line, m.index, m.length)}`);
        if (results.length >= MAX_RESULTS) {
          resultsTruncated = true;
          break;
        }
      }
      // 只对真正命中的文件记录读取基线——grep 扫过但没命中的文件，Claude 并没有看到
      // 它的内容（结果里不会出现），不构成"已读取该文件内容"的基线。
      if (hasMatch) {
        self.ClaudefsCore.fs.readTracker.recordRead(relPath, file.lastModified);
      }
    }

    async function walk(dirHandle, relativePath, depth) {
      for await (const [name, entryHandle] of dirHandle.entries()) {
        if (resultsTruncated) return;

        const entryRelPath = relativePath ? `${relativePath}/${name}` : name;
        if (self.ClaudefsCore.fs.glob.matchesAny(entryRelPath, excludePatterns)) continue;

        if (entryHandle.kind === 'directory') {
          if (depth < MAX_DEPTH) {
            await walk(entryHandle, entryRelPath, depth + 1);
          } else {
            scanTruncated = true;
          }
        } else {
          filesScanned++;
          if (filesScanned > MAX_FILES_SCANNED) {
            scanTruncated = true;
            return;
          }
          if (glob && !self.ClaudefsCore.fs.glob.matchBasenameOrPath(entryRelPath, glob)) continue;
          await scanFile(entryHandle, entryRelPath);
        }
      }
    }

    if (startEntry.kind === 'file') {
      // path 显式指向单个文件时直接搜这一个文件，不做目录遍历；glob 参数在这个模式下不
      // 生效（和 ripgrep 一致：显式命名的文件不受 --glob 过滤影响，glob 只筛选目录遍历时
      // 发现的文件），因为用户已经明确点名要搜哪个文件，没有"过滤掉"的意义。
      const relPath = normalizePath(startPath);
      await scanFile(startEntry.handle, relPath);
    } else {
      await walk(startEntry.handle, '', 0);
    }

    const skipNotes = [];
    if (skippedBinary > 0) skipNotes.push(`跳过了 ${skippedBinary} 个二进制文件`);
    if (skippedTooLarge > 0) skipNotes.push(`跳过了 ${skippedTooLarge} 个超过 ${self.ClaudefsCore.fs.limits.MAX_READ_BYTES} 字节上限的文件`);
    const skipSuffix = skipNotes.length > 0 ? `（${skipNotes.join('，')}）` : '';

    let text;
    if (results.length === 0) {
      text = `未找到匹配 "${pattern}"${glob ? `（glob: ${glob}）` : ''}${skipSuffix ? ` ${skipSuffix}` : ''}。`;
    } else {
      text = results.join('\n');
      if (resultsTruncated) {
        text += `\n\n（已截断：结果数达到上限 ${MAX_RESULTS} 条，至少找到 ${MAX_RESULTS} 处匹配，实际可能更多，未全部列出；可用更具体的 pattern/glob 缩小范围后重试）`;
      }
      if (scanTruncated) {
        text += `\n（已达到遍历深度/文件数量安全上限，可能还有未扫描到的文件未被搜索）`;
      }
      if (skipSuffix) {
        text += `\n${skipSuffix}`;
      }
    }

    return { content: [{ type: 'text', text }], structuredContent: { content: text } };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.tools = self.ClaudefsCore.tools || {};
  self.ClaudefsCore.tools[NAME] = { definition, handler };
})();
