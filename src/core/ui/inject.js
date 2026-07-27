// core/ui/inject.js — 宿主无关。
// 往宿主页面里插入常驻 UI 元素，并在它被宿主 SPA 重渲染顶掉后自动重新插入。
// 用 MutationObserver 而不是轮询。
//
// keepMounted 返回一个 stop() 函数：常驻 UI（连接文件夹面板）可以忽略它、永远保活；
// 一次性 UI（diff 确认弹窗）在用户操作完之后必须调用 stop() 再移除元素，否则
// MutationObserver 会把"用户主动关闭"误判成"被 SPA 顶掉"又插回去，弹窗永远关不掉。
(function () {
  function keepMounted(element, options) {
    const opts = options || {};
    let stopped = false;
    let bodyObserver = null;
    let rootObserver = null;

    function getParent() {
      return opts.parent || document.body;
    }

    function tryMount() {
      if (stopped) return;
      const parent = getParent();
      if (parent && !parent.contains(element)) {
        parent.appendChild(element);
      }
    }

    function observeBody() {
      if (stopped) return;
      const parent = getParent();
      if (!parent) return;
      if (bodyObserver) bodyObserver.disconnect();
      bodyObserver = new MutationObserver(tryMount);
      bodyObserver.observe(parent, { childList: true });
    }

    tryMount();
    observeBody();

    // 覆盖 document.body 本身在早期还不存在、或整个被替换的情况。
    if (document.documentElement) {
      rootObserver = new MutationObserver(() => {
        observeBody();
        tryMount();
      });
      rootObserver.observe(document.documentElement, { childList: true });
    }

    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => {
        observeBody();
        tryMount();
      });
    }

    return function stop() {
      stopped = true;
      if (bodyObserver) bodyObserver.disconnect();
      if (rootObserver) rootObserver.disconnect();
    };
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.ui = self.ClaudefsCore.ui || {};
  self.ClaudefsCore.ui.keepMounted = keepMounted;
})();
