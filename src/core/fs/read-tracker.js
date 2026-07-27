// core/fs/read-tracker.js — 宿主无关。
// 写前冲突检测：防"基于陈旧内容盲写"。会话级内存态，不落盘、不跨页面刷新持久化——文件夹断开/重连即清空（reset()）。
//
// 设计：只做「记录读取时的 mtime → 写之前比对」，不拦截、不改任何工具的输入/输出契约。
// 最危险场景：replace_lines/insert_lines 按行号盲写，外部改动致行号偏移会静默改错地方；
// edit_file 的唯一匹配好歹会因为内容变了而匹配失败，行号类工具没有这层天然保护。
//
// normalizedPath 用 sandbox.js 的 splitPath 同款分段拼接（大小写/分隔符原样，不做大小写
// 归一化——File System Access API 本身大小写敏感），保证同一文件不同写法的 path
// （"a/b.txt" vs "a\\b.txt"）能落到同一个 tracker key。
(function () {
  let lastKnownMtime = new Map(); // normalizedPath -> mtime（毫秒）

  function normalize(path) {
    return self.ClaudefsCore.fs.sandbox.normalizePathForTracking(path);
  }

  // 读到内容之后才算基线——get_file_info 只看元信息不读内容，不调用这个。
  function recordRead(path, mtime) {
    lastKnownMtime.set(normalize(path), mtime);
  }

  // 我们自己的写工具成功写盘后调用，把基线更新成刚写完的 mtime，防止自己这次写触发
  // 下一次调用时的误报。
  function recordWrite(path, mtime) {
    lastKnownMtime.set(normalize(path), mtime);
  }

  // 返回 null（无基线，不警示）或者一段可以直接拼进 confirm payload.warning 的文字。
  function checkConflict(path, currentMtime) {
    const key = normalize(path);
    if (!lastKnownMtime.has(key)) return null;
    const known = lastKnownMtime.get(key);
    if (currentMtime <= known) return null;
    return (
      `⚠ This file was modified externally after it was last read (read at ${new Date(known).toISOString()}, ` +
      `now ${new Date(currentMtime).toISOString()}). The old content shown below may be outdated. ` +
      `Consider cancelling and asking Claude to re-read the file before editing.`
    );
  }

  // 文件夹断开/重连时调用，清空全部基线（旧 handle 的 mtime 对新连接的文件夹没有意义）。
  function reset() {
    lastKnownMtime = new Map();
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.fs = self.ClaudefsCore.fs || {};
  self.ClaudefsCore.fs.readTracker = { recordRead, recordWrite, checkConflict, reset };
})();
