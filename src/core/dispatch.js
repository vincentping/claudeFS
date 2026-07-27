// core/dispatch.js — 宿主无关。
// adapter 与 core 之间的统一接口：adapter 只准通过这里调用 core，
// 不得直接依赖 core.tools/* 的内部实现。
(function () {
  function listTools() {
    return Object.values(self.ClaudefsCore.tools || {})
      .map((t) => t.definition)
      .filter((d) => !d.unlisted);
  }

  async function callTool(name, args) {
    const tool = self.ClaudefsCore.tools && self.ClaudefsCore.tools[name];
    if (!tool) {
      throw new Error(`未知工具: ${name}`);
    }
    return tool.handler(args || {});
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.dispatch = { listTools, callTool };
})();
