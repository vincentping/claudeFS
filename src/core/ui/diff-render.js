// core/ui/diff-render.js — 宿主无关，ISOLATED world（确认弹窗在这一侧渲染）。
// 把 core/diff.js 算出来的结构化 diff（{type, text}[]）渲染成带颜色的 DOM。
// 和 core/diff.js 的 formatDiffText 一样做"大段未变内容折叠"，只是这里是渲染 DOM
// 而不是拼文本——两边独立实现（都不复杂），没有强行做成共享代码，因为它们分别只在
// MAIN / ISOLATED 一侧使用，硬共享一份反而要多绕一层文件同步（参考 core/bridge.js
// 那类"两份文件"模式的维护成本）。
(function () {
  function renderDiffLines(container, diffLines, contextLines) {
    const ctx = contextLines == null ? 3 : contextLines;
    const pre = document.createElement('pre');
    Object.assign(pre.style, {
      margin: 0,
      fontFamily: 'ui-monospace, monospace',
      fontSize: '12px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all'
    });

    function addLine(text, type) {
      const div = document.createElement('div');
      div.textContent = (type === 'added' ? '+ ' : type === 'removed' ? '- ' : '  ') + text;
      if (type === 'added') {
        div.style.background = '#0a3d1a';
        div.style.color = '#8fd19e';
      } else if (type === 'removed') {
        div.style.background = '#4a1414';
        div.style.color = '#f0a0a0';
      } else {
        div.style.color = '#bbb';
      }
      pre.appendChild(div);
    }

    function addOmittedMarker(count) {
      const div = document.createElement('div');
      div.textContent = chrome.i18n.getMessage('diffOmitted', [String(count)]);
      div.style.color = '#777';
      div.style.fontStyle = 'italic';
      pre.appendChild(div);
    }

    let i = 0;
    const total = diffLines.length;
    while (i < total) {
      if (diffLines[i].type !== 'unchanged') {
        addLine(diffLines[i].text, diffLines[i].type);
        i++;
        continue;
      }
      let j = i;
      while (j < total && diffLines[j].type === 'unchanged') j++;
      const runLength = j - i;
      const isFirstRun = i === 0;
      const isLastRun = j === total;

      if (runLength <= ctx * 2) {
        for (let k = i; k < j; k++) addLine(diffLines[k].text, 'unchanged');
      } else if (isFirstRun) {
        const start = j - ctx;
        addOmittedMarker(start - i);
        for (let k = start; k < j; k++) addLine(diffLines[k].text, 'unchanged');
      } else if (isLastRun) {
        const end = i + ctx;
        for (let k = i; k < end; k++) addLine(diffLines[k].text, 'unchanged');
        addOmittedMarker(j - end);
      } else {
        for (let k = i; k < i + ctx; k++) addLine(diffLines[k].text, 'unchanged');
        addOmittedMarker(runLength - ctx * 2);
        for (let k = j - ctx; k < j; k++) addLine(diffLines[k].text, 'unchanged');
      }
      i = j;
    }

    container.appendChild(pre);
  }

  // 写前冲突检测（工具增强批次 v2 ③）的警示横幅：确认框顶部一块醒目的黄底文字，
  // 提示"该文件在上次读取后已被外部修改"。只是提醒，不拦截——approve/reject 按钮照常可点。
  function renderConflictWarning(warningText) {
    const banner = document.createElement('div');
    banner.textContent = warningText;
    Object.assign(banner.style, {
      background: '#4a3a0a',
      color: '#f0d080',
      border: '1px solid #8a6a1a',
      borderRadius: '6px',
      padding: '8px 10px',
      marginBottom: '10px',
      fontSize: '12px',
      lineHeight: '1.4'
    });
    return banner;
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.ui = self.ClaudefsCore.ui || {};
  self.ClaudefsCore.ui.renderDiffLines = renderDiffLines;
  self.ClaudefsCore.ui.renderConflictWarning = renderConflictWarning;
})();
