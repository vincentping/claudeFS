// core/fs/handle-store.js — 宿主无关，MAIN world 专用。
// FileSystemDirectoryHandle 的持久化（IndexedDB）+ 当前 handle 的内存持有。
//
// ⚠️ 这份代码在 ISOLATED world 还需要一份一模一样的逻辑，但**不能让 MAIN 和 ISOLATED
// 两个 content_scripts 配置块引用同一个文件路径**——实测发现 Chrome 会把同一个相对路径
// 当成"已经注入过"直接跳过第二次注入（哪怕 world 不同），导致 ISOLATED world 完全没
// 执行这份代码却不报错、无提示，非常隐蔽。所以维护了两份文件：这份给 MAIN world 用，
// `handle-store.isolated.js` 给 ISOLATED world 用。**改动逻辑时两份要同步改。**
//
// IndexedDB 是 claude.ai 页面自己的 origin storage，MAIN/ISOLATED world 的 content
// script 都能访问同一份（这点已经过 spike 实测确认，不是假设）；`currentHandle` 这个
// in-memory 部分则各世界独立：ISOLATED 用它持有"刚拿到/恢复的 handle"，MAIN 用它持有
// "从 ISOLATED 收到的 handle"，供工具实际使用。
(function () {
  const DB_NAME = 'claudefs';
  const STORE_NAME = 'handles';
  const KEY = 'root-directory-handle';

  let currentHandle = null;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveHandle(handle) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadHandle() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearHandle() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function setCurrentHandle(handle) {
    currentHandle = handle;
  }

  function getCurrentHandle() {
    return currentHandle;
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.fs = self.ClaudefsCore.fs || {};
  self.ClaudefsCore.fs.handleStore = {
    saveHandle,
    loadHandle,
    clearHandle,
    setCurrentHandle,
    getCurrentHandle
  };
})();
