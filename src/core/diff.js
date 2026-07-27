// core/diff.js — 宿主无关，MAIN world（diff 是在这里算出来的，旧/新内容都在这一侧）。
// 没有构建步骤引不了 `diff` 这类 npm 包，自己写一个基于 LCS 的最小按行 diff。
// 官方 edit_file 用 `diff` 包的 createTwoFilesPatch 生成 git 风格 unified diff 文本；
// 这里只对齐"观感"（+/− 前缀、折叠大段未变内容），不追求字节级一致。
(function () {
  // LCS 是 O(n*m) 时间和空间，文件行数太大会卡/占内存过多——超过这个阈值就不逐行比较，
  // 退化成"整体删除旧内容 + 整体新增新内容"展示，仍然正确，只是不够精细。
  const MAX_LCS_LINES = 2000;

  function computeLineDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    if (oldLines.length > MAX_LCS_LINES || newLines.length > MAX_LCS_LINES) {
      const result = [];
      for (const line of oldLines) result.push({ type: 'removed', text: line });
      for (const line of newLines) result.push({ type: 'added', text: line });
      return result;
    }

    const n = oldLines.length;
    const m = newLines.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const result = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (oldLines[i] === newLines[j]) {
        result.push({ type: 'unchanged', text: oldLines[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        result.push({ type: 'removed', text: oldLines[i] });
        i++;
      } else {
        result.push({ type: 'added', text: newLines[j] });
        j++;
      }
    }
    while (i < n) {
      result.push({ type: 'removed', text: oldLines[i] });
      i++;
    }
    while (j < m) {
      result.push({ type: 'added', text: newLines[j] });
      j++;
    }
    return result;
  }

  // 把 diff 行数组转成给 Claude 看的紧凑文本：改动行原样带 +/− 前缀，大段未变内容
  // 只保留改动附近 contextLines 行、中间折叠成一行提示，避免把整份文件塞进 tool result。
  function formatDiffText(diffLines, contextLines) {
    const ctx = contextLines == null ? 3 : contextLines;
    const out = [];
    let i = 0;
    const total = diffLines.length;

    while (i < total) {
      if (diffLines[i].type !== 'unchanged') {
        const prefix = diffLines[i].type === 'added' ? '+ ' : '- ';
        out.push(prefix + diffLines[i].text);
        i++;
        continue;
      }

      let j = i;
      while (j < total && diffLines[j].type === 'unchanged') j++;
      const runLength = j - i;
      const isFirstRun = i === 0;
      const isLastRun = j === total;

      if (runLength <= ctx * 2) {
        for (let k = i; k < j; k++) out.push('  ' + diffLines[k].text);
      } else if (isFirstRun) {
        const start = j - ctx;
        out.push(`  ... (${start - i} 行未变) ...`);
        for (let k = start; k < j; k++) out.push('  ' + diffLines[k].text);
      } else if (isLastRun) {
        const end = i + ctx;
        for (let k = i; k < end; k++) out.push('  ' + diffLines[k].text);
        out.push(`  ... (${j - end} 行未变) ...`);
      } else {
        for (let k = i; k < i + ctx; k++) out.push('  ' + diffLines[k].text);
        out.push(`  ... (${runLength - ctx * 2} 行未变) ...`);
        for (let k = j - ctx; k < j; k++) out.push('  ' + diffLines[k].text);
      }
      i = j;
    }
    return out.join('\n');
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.diff = { computeLineDiff, formatDiffText };
})();
