// adapters/claude/content-isolated.js — claude.ai 适配层，ISOLATED world。
// 职责：
//   1. 目录选择 UI 的宿主：在页面内注入连接面板，用真实用户点击调用
//      showDirectoryPicker()，再经 core/bridge.isolated.js 的私有通道交给 MAIN world 使用。
//   2. handle 的 IndexedDB 持久化 + 页面（重）加载时的权限恢复。
//   3. 断开连接 / 换目录这类连接生命周期管理（工具栏 popup 状态面板留到后续打磨阶段做；
//      这里先只做面板本身能完整覆盖的操作）。
(function () {
  const TAG = '[claudefs:isolated]';
  const log = (...args) => console.log(TAG, ...args);

  const { saveHandle, loadHandle, clearHandle, setCurrentHandle } = self.ClaudefsCore.fs.handleStore;

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    zIndex: 999999,
    background: '#1e1e1e',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 2px 10px rgba(0,0,0,.35)',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    alignItems: 'flex-start'
  });
  self.ClaudefsCore.ui.keepMounted(panel);

  function makeButton(text, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    Object.assign(b.style, {
      cursor: 'pointer',
      background: '#333',
      color: '#fff',
      border: '1px solid #555',
      borderRadius: '6px',
      padding: '5px 9px',
      fontSize: '12px'
    });
    b.onclick = onClick;
    return b;
  }

  // FileSystemDirectoryHandle 只暴露 `.name`（隐私考虑，浏览器不会给完整系统路径），
  // 鼠标悬停时用"顶层内容预览"帮用户确认是不是他想连的那个文件夹。
  async function attachContentPreview(el, handle) {
    try {
      const names = [];
      let total = 0;
      for await (const [name] of handle.entries()) {
        total++;
        if (names.length < 8) names.push(name);
      }
      const preview = names.length > 0 ? names.join(', ') : chrome.i18n.getMessage('previewEmpty');
      const more = total > names.length ? ` ${chrome.i18n.getMessage('previewMore', [String(total)])}` : '';
      el.title = `${handle.name}\n${chrome.i18n.getMessage('previewContains', [preview])}${more}`;
    } catch (e) {
      el.title = chrome.i18n.getMessage('previewFailed', [handle.name, e.message]);
    }
  }

  // claude.ai MCP 握手状态（来自 MAIN world，经 core/bridge.isolated.js 私有通道；
  // 不是 bridge 自身建立那个握手）。默认 'pending'——bridge
  // 建立完成前收不到任何消息，'pending' 天然是安全的初始值：不暴露任何连接按钮。
  // 只有握手 'success' 才展示原有的连接状态机（disconnected/connected/needs-reauth）；
  // 'pending'/'failed' 时无论 IndexedDB 里恢复出什么 handle，都不渲染按钮——避免在
  // 非对话页/未就绪页面上出现"连了也是空转"的按钮（判断依据是握手状态本身，不依赖
  // URL 或登录态）。
  let mcpHandshakeStatus = 'pending';
  let latestConnectionState = { status: 'checking' };

  self.ClaudefsCore.bridge.onMessage('mcp-handshake-status', (payload) => {
    mcpHandshakeStatus = (payload && payload.status) || 'pending';
    log('claude.ai MCP 握手状态更新:', mcpHandshakeStatus);
    render(latestConnectionState);
  });

  function render(state) {
    latestConnectionState = state;
    panel.innerHTML = '';

    const statusLine = document.createElement('div');
    const buttonRow = document.createElement('div');
    Object.assign(buttonRow.style, { display: 'flex', gap: '6px' });

    if (mcpHandshakeStatus === 'pending') {
      statusLine.textContent = chrome.i18n.getMessage('statusWaitingReady');
      panel.appendChild(statusLine);
      return;
    }
    if (mcpHandshakeStatus === 'failed') {
      statusLine.textContent = chrome.i18n.getMessage('statusHandshakeFailed');
      panel.appendChild(statusLine);
      return;
    }

    if (state.status === 'checking') {
      statusLine.textContent = chrome.i18n.getMessage('statusChecking');
    } else if (state.status === 'disconnected') {
      statusLine.textContent = chrome.i18n.getMessage('statusDisconnected');
      buttonRow.appendChild(makeButton(chrome.i18n.getMessage('btnConnect'), connectNew));
    } else if (state.status === 'connected') {
      statusLine.textContent = chrome.i18n.getMessage('statusConnected', [state.handle.name]);
      statusLine.title = chrome.i18n.getMessage('previewLoading');
      attachContentPreview(statusLine, state.handle);
      buttonRow.appendChild(makeButton(chrome.i18n.getMessage('btnChangeFolder'), connectNew));
      buttonRow.appendChild(makeButton(chrome.i18n.getMessage('btnDisconnect'), disconnect));
    } else if (state.status === 'needs-reauth') {
      statusLine.textContent = chrome.i18n.getMessage('statusNeedsReauth', [state.handle.name]);
      buttonRow.appendChild(makeButton(chrome.i18n.getMessage('btnReauthorize'), () => reauthorize(state.handle)));
      buttonRow.appendChild(makeButton(chrome.i18n.getMessage('btnChangeFolder'), connectNew));
      buttonRow.appendChild(makeButton(chrome.i18n.getMessage('btnDisconnect'), disconnect));
    }

    panel.appendChild(statusLine);
    panel.appendChild(buttonRow);
  }

  // 经 core/bridge.isolated.js 的私有 MessageChannel 转发，不再用 window.postMessage
  // 广播——页面里其他脚本无法伪造或窃听这条消息。
  function relayToMain(handle) {
    setCurrentHandle(handle);
    self.ClaudefsCore.bridge.send('handle-relay', { handle });
  }

  async function connectNew() {
    try {
      const handle = await window.showDirectoryPicker();
      await saveHandle(handle);
      relayToMain(handle);
      render({ status: 'connected', handle });
      log('已连接文件夹:', handle.name);
    } catch (e) {
      log('showDirectoryPicker 失败或用户取消:', String(e));
    }
  }

  async function disconnect() {
    try {
      await clearHandle();
    } catch (e) {
      log('clearHandle 失败:', String(e));
    }
    relayToMain(null);
    render({ status: 'disconnected' });
    log('已断开连接');
  }

  async function reauthorize(handle) {
    try {
      const perm = await handle.requestPermission({ mode: 'read' });
      if (perm === 'granted') {
        relayToMain(handle);
        render({ status: 'connected', handle });
        log('重新授权成功:', handle.name);
      } else {
        log('用户拒绝了重新授权:', handle.name);
      }
    } catch (e) {
      log('requestPermission 失败:', String(e));
    }
  }

  (async function init() {
    render({ status: 'checking' });

    let handle = null;
    try {
      handle = await loadHandle();
    } catch (e) {
      log('loadHandle 失败:', String(e));
    }

    if (!handle) {
      render({ status: 'disconnected' });
      log('IndexedDB 里没有已保存的 handle，等待用户首次连接');
      return;
    }

    const perm = await handle.queryPermission({ mode: 'read' });
    log('从 IndexedDB 恢复到 handle:', handle.name, '当前权限状态:', perm);

    if (perm === 'granted') {
      relayToMain(handle);
      render({ status: 'connected', handle });
      log('权限仍然有效，已自动重连，无需用户操作');
    } else {
      render({ status: 'needs-reauth', handle });
      log('权限需要用户手势确认才能恢复');
    }
  })();

  log('ISOLATED world adapter loaded at', location.href);
})();
