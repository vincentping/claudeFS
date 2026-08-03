// core/fs/limits.js — 宿主无关。
// 需要整读文件进内存的工具共用的大小上限。官方 server-filesystem 没有这个限制（Node fs
// 直接读），但浏览器里把一个巨大文件整个读进 JS 字符串风险更高，故加此限制。5MB 是可调
// 的起始值，此前在 edit-file.js / move-file.js / insert-lines.js /
// read-multiple-files.js / grep-files.js / read-file.js / read-file-lines.js /
// get-file-info.js 里各自硬编码同一个数字，现合并到这一处共享常量。
//
// 只对"必须整读全文才能操作"的工具生效（编辑、比对、整体覆盖等）；像 read_file 的
// head/tail 模式、append_file 的定位写，本就不整读，不受此限制。
// MAX_MEDIA_READ_BYTES 是 read_media_file 独立的整读上限，语义与 MAX_READ_BYTES 不同：
// 官方 read_media_file 本身没有大小限制（Node fs 直接读），这里加限制是本产品自己的决定
// ——base64 编码后体积再膨胀约 33%，塞进 MCP 工具结果对上下文是重负担，故单独定一个更保守
// 的默认值，不与文本整读上限共用同一个数字（即便当前取值恰好相同，语义上仍是两件事，
// 各自调整不应互相牵连）。
(function () {
  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.fs = self.ClaudefsCore.fs || {};
  self.ClaudefsCore.fs.limits = {
    MAX_READ_BYTES: 5 * 1024 * 1024,
    MAX_MEDIA_READ_BYTES: 5 * 1024 * 1024
  };
})();
