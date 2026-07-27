// core/confirm.js — 宿主无关，MAIN world 侧。
// 写操作的 diff 确认请求/响应编排。工具 handler 调 requestConfirmation()，拿到一个
// Promise，内部经 core/bridge.js 私有通道把请求发给 ISOLATED world 渲染确认 UI，
// 等用户点批准/拒绝，ISOLATED 把结果传回来才 resolve。
//
// 安全铁律：调用方必须在拿到 { approved: true } 之后才能碰磁盘，这个模块本身不碰任何
// 文件系统 API，只负责"等用户做决定"。
//
// 不设超时——用户看 diff 花多久是他的自由，不该被技术性打断（和 bridge 建立、握手那种
// "判断对方是否还在"的超时是两回事）。requestId 配对支持多个写请求并发挂起，互不影响。
(function () {
  const pending = new Map();
  let nextId = 1;

  function requestConfirmation(payload) {
    const requestId = `confirm-${nextId++}`;
    return new Promise((resolve) => {
      pending.set(requestId, resolve);
      self.ClaudefsCore.bridge.send('diff-confirm-request', Object.assign({ requestId }, payload));
    });
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.bridge.onMessage('diff-confirm-response', (payload) => {
    const requestId = payload && payload.requestId;
    const resolve = pending.get(requestId);
    if (!resolve) return; // 未知/已经处理过的 requestId，忽略
    pending.delete(requestId);
    resolve({ approved: !!(payload && payload.approved) });
  });

  self.ClaudefsCore.confirm = { requestConfirmation };
})();
