// core/fs/limits.js — 宿主无关。
// 需要整读文件进内存的工具共用的大小上限。官方 server-filesystem 没有这个限制（Node fs
// 直接读），但 DESIGN.md §3.1 要求我们加——浏览器里把一个巨大文件整个读进 JS 字符串风险
// 更高。5MB 是可调的起始值，此前在 edit-file.js / move-file.js / insert-lines.js /
// read-multiple-files.js / grep-files.js / read-file.js / read-file-lines.js /
// get-file-info.js 里各自硬编码同一个数字，现合并到这一处共享常量。
//
// 只对"必须整读全文才能操作"的工具生效（编辑、比对、整体覆盖等）；像 read_file 的
// head/tail 模式、append_file 的定位写，本就不整读，不受此限制。
(function () {
  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.fs = self.ClaudefsCore.fs || {};
  self.ClaudefsCore.fs.limits = { MAX_READ_BYTES: 5 * 1024 * 1024 };
})();
