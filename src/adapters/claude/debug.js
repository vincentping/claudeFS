// adapters/claude/debug.js — opt-in diagnostics. MAIN world, document_start, loaded first.
//
// Off by default: unless the user turns it on, this file only defines a claudefsDebug()
// helper that explains how to enable it, and does nothing else (no fetch observer, no
// recording). To turn it on, run in the DevTools console on claude.ai and reload:
//   localStorage.setItem('claudefs.debug', 'on')
// and to turn it off again: localStorage.removeItem('claudefs.debug')
//
// Purpose: when a user reports a problem we can't see their screen, so the key signals are
// collected into one report. The user runs  claudefsDebug()  in the DevTools console; it
// prints the report and copies it to the clipboard so it can be pasted into a bug report.
// Nothing is ever sent anywhere by the extension.
//
// Only sizes, counts, booleans and tool names are recorded. No conversation content, file
// content, or request/response bodies are stored.
//
// Signals recorded:
//   - shim: whether userAgent carries a Claude/ token, whether claudeAppBindings is installed,
//           and which registerBinding keys the frontend used (= which desktop-only paths ran)
//   - experience: whether the app_start bootstrap includes claude_ai_hub_web_delivery
//                 (= new experience)
//   - handshake: attempts and outcome of the mcp-server-connected handshake
//   - mcp: counts of initialize / tools/list / tools/call / unknown methods, plus tool name
//          and success for each tools/call
//   - performAction: body size of each PerformAction request and whether claudeFS tool names
//                    appear in it (if they do, client_tools carried our tools)
(function () {
  const TAG = '[claudefs:debug]';
  const BUILD = 'claudeFS 0.2.0';

  let enabled = false;
  try {
    enabled = window.localStorage.getItem('claudefs.debug') === 'on';
  } catch {
    enabled = false;
  }
  if (!enabled) {
    // Leave self.ClaudefsDebug undefined so the other modules skip their reporting calls.
    window.claudefsDebug = function () {
      return (
        "claudeFS diagnostics are off. Run localStorage.setItem('claudefs.debug', 'on'), " +
        'reload the page, reproduce the problem, then run claudefsDebug() again.'
      );
    };
    return;
  }

  const MAX_EVENTS = 200;
  const startedAt = new Date().toISOString();

  const state = {
    shim: { userAgentPatched: null, bindingsStub: null, version: null, disabled: false, registerBindingKeys: [] },
    experience: { appStartSeen: false, hubWebDelivery: null, gatedImports: null },
    handshake: { attempts: 0, status: 'not-started' },
    mcp: { initialize: 0, toolsList: 0, toolsCall: 0, unknownMethods: {}, calls: [] },
    performAction: [],
    errors: [],
    events: []
  };

  function now() {
    return new Date().toISOString();
  }

  function pushCapped(list, item, cap) {
    list.push(item);
    if (list.length > cap) list.splice(0, list.length - cap);
  }

  function record(type, data) {
    pushCapped(state.events, { t: now(), type, ...(data || {}) }, MAX_EVENTS);
  }

  function error(where, err) {
    pushCapped(state.errors, { t: now(), where, message: String((err && err.message) || err) }, 50);
  }

  // ---- Reporting API used by the other modules ----
  const api = {
    shim(info) {
      Object.assign(state.shim, info);
      record('shim', info);
    },
    registerBinding(key) {
      if (!state.shim.registerBindingKeys.includes(key)) state.shim.registerBindingKeys.push(String(key));
      record('registerBinding', { key: String(key) });
    },
    handshake(attempt, status) {
      state.handshake.attempts = Math.max(state.handshake.attempts, attempt || 0);
      if (status) state.handshake.status = status;
      record('handshake', { attempt, status });
    },
    mcp(method, extra) {
      if (method === 'initialize') state.mcp.initialize++;
      else if (method === 'tools/list') state.mcp.toolsList++;
      else if (method === 'tools/call') {
        state.mcp.toolsCall++;
        pushCapped(state.mcp.calls, { t: now(), ...(extra || {}) }, 50);
        console.log(TAG, 'tools/call', extra && extra.name, extra && (extra.ok ? 'ok' : 'error'));
      } else if (method && method !== 'notifications/initialized') {
        state.mcp.unknownMethods[method] = (state.mcp.unknownMethods[method] || 0) + 1;
      }
      record('mcp', { method, ...(extra || {}) });
    },
    error
  };

  // ---- fetch observer: only looks at app_start and PerformAction; never alters requests or responses ----
  function toolNames() {
    try {
      const d = self.ClaudefsCore && self.ClaudefsCore.dispatch;
      return d ? d.listTools().map((t) => t.name) : [];
    } catch (e) {
      return [];
    }
  }

  async function bodyBytes(body) {
    if (body == null) return null;
    if (typeof body === 'string') return new TextEncoder().encode(body);
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (typeof Blob !== 'undefined' && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    return undefined; // ReadableStream / FormData etc.: not read, so the stream isn't consumed
  }

  async function inspectPerformAction(url, init) {
    try {
      const bytes = await bodyBytes(init && init.body);
      const entry = { t: now(), bytes: bytes ? bytes.byteLength : null, bodyType: null, claudefsToolNamesFound: 0 };
      if (bytes === undefined) entry.bodyType = 'stream-or-other (not inspected)';
      else if (bytes === null) entry.bodyType = 'empty';
      else {
        entry.bodyType = 'bytes';
        // Strings are plain UTF-8 in both protobuf and JSON, so a latin1 decode + substring match is enough
        const text = new TextDecoder('latin1').decode(bytes);
        const names = toolNames();
        entry.claudefsToolNamesFound = names.filter((n) => text.includes(n)).length;
        entry.claudefsToolNamesTotal = names.length;
        entry.mentionsClaudeFS = /claudeFS/i.test(text);
      }
      pushCapped(state.performAction, entry, 30);
      console.log(
        TAG,
        `PerformAction body=${entry.bytes ?? '?'} bytes, claudeFS tool names found: ${entry.claudefsToolNamesFound}` +
          (entry.claudefsToolNamesTotal ? `/${entry.claudefsToolNamesTotal}` : '')
      );
    } catch (e) {
      error('inspectPerformAction', e);
    }
  }

  async function inspectAppStart(response) {
    try {
      const data = await response.clone().json();
      const gated = data && data.gated_imports ? Object.keys(data.gated_imports) : [];
      state.experience = {
        appStartSeen: true,
        hubWebDelivery: gated.includes('claude_ai_hub_web_delivery'),
        gatedImports: gated
      };
      record('appStart', { hubWebDelivery: state.experience.hubWebDelivery });
      console.log(TAG, 'experience:', state.experience.hubWebDelivery ? 'NEW (hub)' : 'old');
    } catch (e) {
      error('inspectAppStart', e);
    }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      let url = '';
      try {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input && input.url) || '';
      } catch (e) {
        /* ignore */
      }
      const isPerformAction = url.includes('ConversationService/PerformAction');
      const isAppStart = url.includes('/edge-api/bootstrap/') && url.includes('/app_start');
      if (isPerformAction) {
        // Request object: read a clone so the real request is untouched
        if (input instanceof Request && !(init && init.body)) {
          input
            .clone()
            .arrayBuffer()
            .then((buf) => inspectPerformAction(url, { body: buf }))
            .catch((e) => error('performAction.clone', e));
        } else {
          inspectPerformAction(url, init);
        }
      }
      const p = originalFetch.apply(this, arguments);
      if (isAppStart) p.then(inspectAppStart, (e) => error('appStart.fetch', e));
      return p;
    };
  }

  // ---- Report ----
  function report() {
    const ua = navigator.userAgent;
    return {
      build: BUILD,
      startedAt,
      generatedAt: now(),
      page: location.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<uuid>'),
      userAgentHasClaudeToken: /claude(nest|gov)?\/[^ ]+/i.test(ua),
      hasClaudeAppBindings: !!window.claudeAppBindings,
      shim: state.shim,
      experience: state.experience,
      handshake: state.handshake,
      mcp: state.mcp,
      performAction: state.performAction,
      errors: state.errors,
      recentEvents: state.events.slice(-60)
    };
  }

  window.claudefsDebug = function () {
    const json = JSON.stringify(report(), null, 2);
    console.log(json);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(
        () => console.log(TAG, 'report copied to clipboard — please paste it into your reply'),
        () => console.log(TAG, 'could not copy automatically — please copy the JSON printed above')
      );
    }
    return 'claudeFS debug report printed above';
  };

  self.ClaudefsDebug = api;
  console.log(TAG, BUILD, 'loaded — run claudefsDebug() in this console for a report');
})();
