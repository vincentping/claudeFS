// core/fs/handle-store.isolated.js — 宿主无关，ISOLATED world 专用。
//
// 这是 `handle-store.js` 的逐字复制，唯一原因是 Chrome 的一个坑：如果 MAIN 和
// ISOLATED 两个 content_scripts 配置块引用同一个文件相对路径，Chrome 会把第二次
// 引用当成"已经注入过"直接跳过——不报错、不提示，该 world 里这份代码就是没跑。
// 实测确认（2026-07）：只有 world=MAIN 的那份会执行 console.log 标记，
// world=ISOLATED 完全不出现。
//
// **改这份文件时，`handle-store.js` 那份要同步改，反之亦然。**
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
