// core/fs/default-excludes.js — 宿主无关。
// 递归遍历类扩展工具默认忽略的目录名（浏览器安全默认值，官方 Node 版没有这个概念，纯粹是
// 我们自己的"确定性铺量"工具为了不在大仓库上卡死标签页而加的默认值）。
//
// 目前只被 grep_files 复用。directory_tree 更早就有自己的同值本地常量（['node_modules',
// '.git']），本次任务没有回头改 directory-tree.js（它是已上线、真实环境实测过的工具，
// 今天任务范围是新增工具，不顺手碰它以降低风险）——两处数组内容目前一致，如果以后要调整
// 默认排除列表，记得两边都要改。
(function () {
  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.fs = self.ClaudefsCore.fs || {};
  self.ClaudefsCore.fs.defaultExcludes = ['node_modules', '.git'];
})();
