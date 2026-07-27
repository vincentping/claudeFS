// adapters/claude/content-main.js — claude.ai 适配层，MAIN world。
// 职责：
//   1. 冒充桌面壳握手：发送 mcp-server-connected + MessagePort，失败自动重试。
//   2. 实现 MCP server 端协议：交给 mcp/protocol.js 处理。
//   3. 经 core/bridge.js 私有通道接收 ISOLATED world 转发来的目录 handle，交给
//      core/fs/handle-store 供工具使用（不再走 window.postMessage 广播，见 core/bridge.js）。
(function () {
  const TAG = '[claudefs]';
  const log = (...args) => console.log(TAG, ...args);

  const MAX_HANDSHAKE_ATTEMPTS = 5;

  // claude.ai MCP 握手状态（不是 bridge 建立那个握手）：
  // 'pending' → 'success'（收到 initialize）或 'failed'（重试耗尽仍无响应）。
  // 单向前进，不回退；连接面板 UI（ISOLATED world）据此决定是否展示连接按钮
  // ——只有真正的 claude.ai 对话页才会响应握手，非对话页/未登录都会走到 'failed'。
  function reportHandshakeStatus(status) {
    self.ClaudefsCore.bridge.send('mcp-handshake-status', { status });
  }

  function sendHandshake() {
    let attempt = 0;
    let settled = false;

    reportHandshakeStatus('pending');

    function tryOnce() {
      attempt++;
      const channel = new MessageChannel();
      const port1 = channel.port1;
      const port2 = channel.port2;

      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      const timeout = setTimeout(() => {
        if (settled) return;
        port1.close();
        if (attempt < MAX_HANDSHAKE_ATTEMPTS) {
          log(`第 ${attempt} 次握手超时（${backoffMs}ms 内未收到 initialize），重试`);
          tryOnce();
        } else {
          log(`握手 ${MAX_HANDSHAKE_ATTEMPTS} 次均超时，放弃。claude.ai 前端接口可能已变化，建议刷新页面重试。`);
          reportHandshakeStatus('failed');
        }
      }, backoffMs);

      port1.onmessage = (event) => {
        if (!settled && event.data && event.data.method === 'initialize') {
          settled = true;
          clearTimeout(timeout);
          log('收到 initialize，握手确认成功，尝试次数:', attempt);
          reportHandshakeStatus('success');
        }
        self.ClaudefsClaude.mcp.handleMessage(event.data, (reply) => port1.postMessage(reply));
      };
      port1.start();

      window.postMessage(
        {
          source: 'main-content',
          type: 'mcp-server-connected',
          serverName: self.ClaudefsClaude.mcp.SERVER_NAME
        },
        '*',
        [port2]
      );
      log(`发送握手（第 ${attempt} 次尝试）`);
    }

    tryOnce();
  }

  // 经私有 bridge 接收 ISOLATED world 转发来的目录 handle（唯一被验证过可行的
  // 传递路径：ISOLATED 调 showDirectoryPicker() → bridge → MAIN，绝不能改走
  // chrome.runtime/tabs 消息，会被静默降级成空壳）。
  // handle 走私有 port 而不是 window.postMessage 广播，页面其他脚本无法伪造/窃听；
  // 这里再加一道类型校验兜底。
  self.ClaudefsCore.bridge.onMessage('handle-relay', (payload) => {
    const handle = payload && payload.handle;
    if (handle !== null && !(handle instanceof FileSystemDirectoryHandle)) {
      log('忽略非法的 handle-relay payload（未通过类型校验）:', handle);
      return;
    }
    self.ClaudefsCore.fs.handleStore.setCurrentHandle(handle);
    // 断开/换目录/重新授权都会走到这里（handle 换了新值或变成 null）——旧 handle 下
    // 记录的 mtime 基线对新连接的文件夹没有意义，一并清空（工具增强批次 v2 ③）。
    self.ClaudefsCore.fs.readTracker.reset();
    log('directory handle received from ISOLATED world:', handle && handle.name);
  });

  sendHandshake();
  log('MAIN world adapter loaded at', location.href);
})();
