// core/confirm.isolated.js — 宿主无关，ISOLATED world 侧。
// core/confirm.js 的接收方：收到 diff-confirm-request 后渲染一个居中弹窗，用户点
// 批准/拒绝后把结果经 bridge 传回 MAIN world。
//
// 弹窗用 core/ui/inject.js 的 keepMounted 保活（防止 claude.ai 重渲染时把弹窗顶掉、
// 用户正看着 diff 结果突然消失、写操作永远卡在等待确认）；用户操作完之后必须调用
// keepMounted 返回的 stop()，否则 MutationObserver 会把"主动关闭"误判成"被顶掉"又插回去。
//
// 支持多个确认请求同时挂起：每个请求各自建一个独立的 overlay + keepMounted 实例，
// 互不干扰（按 z-index 顺序堆叠，不排队）。
(function () {
  self.ClaudefsCore.bridge.onMessage('diff-confirm-request', (payload) => {
    showConfirmModal(payload || {});
  });

  function showConfirmModal({ requestId, path, title, diffLines, fullContent, warning }) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,.55)',
      zIndex: 1000000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif'
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#1e1e1e',
      color: '#fff',
      borderRadius: '10px',
      padding: '18px',
      width: 'min(720px, 90vw)',
      maxHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 8px 30px rgba(0,0,0,.5)'
    });

    const heading = document.createElement('div');
    heading.textContent = title || path || chrome.i18n.getMessage('confirmTitle');
    Object.assign(heading.style, { fontWeight: 'bold', fontSize: '14px', marginBottom: '10px' });
    box.appendChild(heading);

    // 写前冲突检测（工具增强批次 v2 ③）：文件在上次读取后被外部修改时，写工具会把警示文字
    // 放进 payload.warning；警示不拦截，只是让人在批准前多看一眼，最终把关仍由人决定。
    if (warning) {
      box.appendChild(self.ClaudefsCore.ui.renderConflictWarning(warning));
    }

    const body = document.createElement('div');
    Object.assign(body.style, { overflow: 'auto', border: '1px solid #3a3a3a', borderRadius: '6px', padding: '8px' });
    box.appendChild(body);

    if (fullContent != null) {
      const pre = document.createElement('pre');
      pre.textContent = fullContent;
      Object.assign(pre.style, {
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontSize: '12px',
        fontFamily: 'ui-monospace, monospace'
      });
      body.appendChild(pre);
    } else {
      self.ClaudefsCore.ui.renderDiffLines(body, diffLines || []);
    }

    const buttonRow = document.createElement('div');
    Object.assign(buttonRow.style, { marginTop: '14px', display: 'flex', gap: '10px', justifyContent: 'flex-end' });

    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = chrome.i18n.getMessage('btnReject');
    const approveBtn = document.createElement('button');
    approveBtn.textContent = chrome.i18n.getMessage('btnApprove');
    [rejectBtn, approveBtn].forEach((b) => {
      Object.assign(b.style, {
        cursor: 'pointer',
        padding: '8px 18px',
        borderRadius: '6px',
        border: '1px solid #555',
        fontSize: '13px',
        color: '#fff'
      });
    });
    rejectBtn.style.background = '#333';
    approveBtn.style.background = '#2d6a2d';

    const stopKeepMounted = self.ClaudefsCore.ui.keepMounted(overlay);

    function respond(approved) {
      self.ClaudefsCore.bridge.send('diff-confirm-response', { requestId, approved });
      stopKeepMounted();
      overlay.remove();
    }
    rejectBtn.onclick = () => respond(false);
    approveBtn.onclick = () => respond(true);

    buttonRow.appendChild(rejectBtn);
    buttonRow.appendChild(approveBtn);
    box.appendChild(buttonRow);
    overlay.appendChild(box);
  }
})();
