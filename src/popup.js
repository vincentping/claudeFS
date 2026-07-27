// popup.js — 工具栏点击弹出的极简说明页，不展示连接状态。
// popup.html 是静态 HTML，__MSG_xxx__ 语法只在 manifest.json 里自动替换，这里手动调
// chrome.i18n.getMessage() 写入 DOM，和 D24 三个 UI 文件的做法保持一致。
(function () {
  document.getElementById('popupName').textContent = chrome.i18n.getMessage('extName');
  document.getElementById('popupDescription').textContent = chrome.i18n.getMessage('extDescription');
  document.getElementById('popupHint').textContent = chrome.i18n.getMessage('popupConnectHint');
})();
