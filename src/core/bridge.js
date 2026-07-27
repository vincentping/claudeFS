// core/bridge.js — 宿主无关，MAIN world 专用。
// 这是 `bridge.isolated.js` 的接收方，设计说明看那份文件顶部注释。四个函数
// （dispatch/flushOutbox/send/onMessage）与 bridge.isolated.js 逐字同步，
// bridge.isolated.js 那边另有单向的 establish() 建桥重试逻辑，这份没有。
//
// **改这四个共享函数时，`bridge.isolated.js` 要同步改**（原因同样是 Chrome 那个同路径
// 跨 world 静默跳过注入的坑，见 core/fs/handle-store.js 注释；校验：
// `node scripts/check-file-pairs-sync.js`）。
(function () {
  const TAG = '[claudefs:bridge]';
  const log = (...args) => console.log(TAG, ...args);

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

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (port) return; // 已经建立过了，忽略后续的 init 广播（比如对面重试时的旧尝试）
    if (event.data && event.data.type === 'claudefs-bridge-init' && event.data.source === 'isolated-content') {
      port = event.ports[0];
      port.onmessage = (e) => {
        if (e.data) dispatch(e.data.type, e.data.payload);
      };
      port.postMessage({ type: 'claudefs-bridge-ack' });
      flushOutbox();
      log('桥建立成功（接收方）');
    }
  });

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.bridge = { send, onMessage };
})();
