// adapters/claude/mcp/protocol.js — claude.ai 适配层。
// JSON-RPC 消息处理：initialize / notifications/initialized / tools/list / tools/call。
// 只负责协议翻译，具体工具执行全部经 core/dispatch.js（架构铁律：adapter 不碰 core 内部实现）。
(function () {
  const SERVER_NAME = 'claudeFS';
  const SERVER_VERSION = '0.1.0';

  async function handleMessage(msg, reply) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.method) {
      case 'initialize':
        reply({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
          }
        });
        break;

      case 'notifications/initialized':
        // 通知，无需回复。
        break;

      case 'tools/list':
        reply({
          jsonrpc: '2.0',
          id: msg.id,
          result: { tools: self.ClaudefsCore.dispatch.listTools() }
        });
        break;

      case 'tools/call': {
        const params = msg.params || {};
        try {
          const raw = await self.ClaudefsCore.dispatch.callTool(params.name, params.arguments);
          // 现在 core/tools/ 下所有工具都返回带 structuredContent 的完整结果对象，此处
          // 兼容裸字符串只作防御性兜底——万一哪天某个工具的返回路径漏包了，这里能兜住让
          // 调用不炸，而不是让裸值原样发给 claude.ai（那样会更隐蔽地坏掉）。正常情况下
          // 不应该走到 raw 是字符串的分支。
          const result =
            raw && typeof raw === 'object' && Array.isArray(raw.content)
              ? raw
              : { content: [{ type: 'text', text: String(raw) }] };
          reply({ jsonrpc: '2.0', id: msg.id, result });
        } catch (e) {
          reply({
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true }
          });
        }
        break;
      }

      default:
        // 未知 method，忽略（后续如需要可加日志埋点观察是否有新协议消息）。
        break;
    }
  }

  self.ClaudefsClaude = self.ClaudefsClaude || {};
  self.ClaudefsClaude.mcp = { handleMessage, SERVER_NAME };
})();
