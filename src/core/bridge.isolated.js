// core/bridge.isolated.js — 宿主无关，ISOLATED world 专用。
//
// 建一个只有 ISOLATED 和 MAIN 两侧持有引用的私有 MessageChannel，之后所有需要
// ISOLATED↔MAIN 传递的消息（handle-relay、以后 write_file 的 diff 确认请求/响应）
// 都走这个 port，不再用 window.postMessage 广播——常态下页面里其他脚本无法伪造或窃听。
//
// 建立过程本身仍要用一次 window.postMessage 广播来交接 port（这是 MessageChannel
// 跨 world 转移唯一可行的方式）。这一步理论上仍可能被"恰好也在监听 message 事件、
// 且先我们一步读到该事件"的脚本截获——这是该模式的固有特性，握手环节（content-main.js
// 的 sendHandshake）也有相同的暴露面，我们已经接受这个风险。真正的改善在于：
// 建立完成后，所有后续流量都走私有 port，不再广播，日常无法被伪造/窃听，只有这一次
// 极窄的建立瞬间存在理论暴露面。
//
// 建立时如果 MAIN world 还没跑到这一行（两个 world 的注入时机不保证先后），第一次广播
// 会石沉大海——所以这里跟 P0-2 的握手重试用同一个思路：定超时、没收到 ack 就换一个新
// MessageChannel 重试，指数退避。
//
// 这份文件和 `bridge.js`（MAIN world 那份）不是逐字复制——四个共享函数
// （dispatch/flushOutbox/send/onMessage）与 bridge.js 逐字同步，此外这份多了
// establish() 建桥重试逻辑（单向：只有 ISOLATED 侧主动发起建桥）。维护两份文件的
// 原因见 core/fs/handle-store.js 顶部注释：Chrome 会把"同一相对路径被 MAIN 和
// ISOLATED 两个 content_scripts 配置块引用"当成已经注入过，静默跳过第二次注入。
// **改动四个共享函数时，`bridge.js` 要同步改**（校验：`node scripts/check-file-pairs-sync.js`）。
(function () {
  const TAG = '[claudefs:bridge:isolated]';
  const log = (...args) => console.log(TAG, ...args);

  const MAX_ATTEMPTS = 5;

  const handlers = {};
  const outbox = [];
  let port = null;

  function dispatch(type, payload) {
    const handler = handlers[type];
    if (handler) handler(payload);
    else log('收到没有注册 handler 的消息类型:', type);
  }

  function flushOutbox() {
    while (outbox.length > 0) {
      port.postMessage(outbox.shift());
    }
  }

  function send(type, payload) {
    const msg = { type, payload };
    if (port) port.postMessage(msg);
    else outbox.push(msg);
  }

  function onMessage(type, handler) {
    handlers[type] = handler;
  }

  function establish() {
    let attempt = 0;
    let settled = false;

    function tryOnce() {
      attempt++;
      const channel = new MessageChannel();
      const isolatedPort = channel.port1;
      const mainPort = channel.port2;

      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
      const ackTimeout = setTimeout(() => {
        if (settled) return;
        isolatedPort.close();
        if (attempt < MAX_ATTEMPTS) {
          log(`第 ${attempt} 次建桥超时（${backoffMs}ms），重试`);
          tryOnce();
        } else {
          log(`建桥 ${MAX_ATTEMPTS} 次均超时，放弃。MAIN world 可能没有正常加载。`);
        }
      }, backoffMs);

      isolatedPort.onmessage = (event) => {
        if (!settled && event.data && event.data.type === 'claudefs-bridge-ack') {
          settled = true;
          clearTimeout(ackTimeout);
          port = isolatedPort;
          flushOutbox();
          log('桥建立成功，尝试次数:', attempt);
          return;
        }
        if (event.data) dispatch(event.data.type, event.data.payload);
      };
      isolatedPort.start();

      window.postMessage({ type: 'claudefs-bridge-init', source: 'isolated-content' }, '*', [mainPort]);
    }

    tryOnce();
  }

  establish();

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.bridge = { send, onMessage };
})();
