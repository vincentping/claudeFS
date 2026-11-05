# claude.ai new experience: claudeFS tools never reach the model

- Status: **working, verified 2026-11-05** on a new-experience account — experimental fix on branch `experiment/new-experience`
- Affects: accounts moved to the claude.ai "new experience" (Chat and Cowork unified, internally "hub" / "New chat engine")
- Recorded: 2026-11-05

## Symptoms

On an account with the new experience, everything looks normal on the extension side, but Claude never uses the tools:

- The `mcp-server-connected` handshake succeeds: `initialize` arrives (clientInfo `claude-ai`, with the `io.modelcontextprotocol/ui` extension), `tools/list` is called and returns all tools.
- claudeFS shows up in Customize > Connectors and in the chat toggle, and its tools are enabled in account settings (`enabled_mcp_tools` has every `local:claudeFS:*` set to `true`).
- No `tools/call` ever arrives. Claude says it only sees Claude Docs / the visualize server and that its connector list is empty.
- Messages are sent with `/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/PerformAction` instead of `/completion`, and the request bodies are tiny (100–400 bytes) with no tool names in them.

On an old-experience account the same extension version works (`[COMPLETION] ... mode=legacy`, then `tool_approval_gate`, then `tools/call`).

## Root cause

The new frontend can forward local MCP tools to the model. The send-message action inside `PerformActionRequest` (its `action` oneof) has a repeated `client_tools` field (`ClientToolDeclaration`, field 16), and the declaration builder includes local tools marked `hostedBy: "desktop"`, which is how tools registered through `mcp-server-connected` are stored.

But the caller only does this when it believes the page is running inside the Claude desktop app. Simplified:

```js
const o = isDesktopApp();                 // xn() in the 2026-11-05 build
const p = servedByThisComputer || linksThisComputer || servedByLinkedComputer;
const h = o && !p;
// ...
buildDeclarations(state, {
  ...,
  ...(h ? {} : { omitServer: () => true })   // not desktop: drop every local server
});
```

`isDesktopApp()` requires both:

1. `navigator.userAgent` matches `/claude(nest|gov)?\/([^ ]+)/i`, i.e. contains a `Claude/x.y.z` token
2. `window.claudeAppBindings` exists

The result is cached per page load. In a normal browser tab the first check fails, so every local server is filtered out and the request goes out with no tools. Defining only a `claudeAppBindings` stub from DevTools is not enough: the user agent check still fails, and it runs too late anyway.

This is a client-side gate. Whether the server also accepts `client_tools` from a browser (the HTTP `User-Agent` header is not changed by the shim) is still unknown.

## Experimental fix (branch `experiment/new-experience`)

claudeFS already impersonates the desktop shell's `mcp-server-connected` handshake. The branch extends that to the environment check:

- `src/adapters/claude/desktop-shim.js` (MAIN world, `document_start`, before claude.ai's scripts):
  - appends ` Claude/0.1.0` to `navigator.userAgent` (skipped if a Claude token is already there)
  - installs a no-op `window.claudeAppBindings` with `registerBinding` / `unregisterBinding` (skipped if the real one exists)
  - the version is deliberately below the desktop feature gates found in the code (`>=0.3.7`, `>=0.9.0`, `>=0.12.0`), so fewer desktop-only features switch on
  - `localStorage.setItem('claudefs.desktopShim', 'off')` disables it; `claudefs.desktopShimVersion` overrides the version
- `src/adapters/claude/debug.js`: `claudefsDebug()` in the console prints a report (shim state, detected experience, handshake, MCP call counts, PerformAction body sizes and whether claudeFS tool names appear in them). It records no chat or file content.

The reported version matters: the new experience shows a hard "Upgrade your app" wall when the version is below its minimum. `0.1.0` is rejected; `0.383.0` (the desktop app version seen in app_start on 2026-11-05) clears it. The shim defaults to `0.383.0`; override at runtime with `localStorage.setItem('claudefs.desktopShimVersion', '…')`.

Known risks:

- The whole page now treats itself as the desktop app (`client_platform`, desktop-only UI such as device verification or "Trusted folders" may appear). Observed in testing: only a `cmdK` desktop binding was registered; no device-verification or Trusted-folders UI appeared.
- The server accepts `client_tools` from this client (confirmed in testing — the tools were called and returned results).
- The shim applies to old-experience accounts too, so it must not ship to `main` until it is tested on both.
- It depends on claude.ai internals and can break with any frontend update, including a future bump to the minimum version behind the upgrade wall.

## Test result (2026-11-05)

Loaded the branch on a new-experience account and sent "read the readme.md in the linked folder":

- PerformAction request for the user's message: **23,544 bytes, carrying all 21 claudeFS tool names** (before the fix, the reporter saw 100–382 byte bodies with none).
- Claude made **7 claudeFS tool calls** (`search_files`, `list_allowed_directories`, `list_directory`, `read_text_file`) and got results back.
- No errors; no upgrade wall (with version 0.383.0); no device-verification prompt.

The one `read_text_file` that returned `ok:false` was Claude guessing the filename before searching; the connected folder happened to contain no readme, which is unrelated to the mechanism.

## How it was investigated

The minified frontend changes with every build, so the method matters more than the names.

1. **Get the asset list.** While claude.ai loads, it fetches
   `https://claude.ai/edge-api/bootstrap/<org-uuid>/app_start?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=true`.
   Its `gated_imports` object lists gated bundles. New-experience accounts have an extra `claude_ai_hub_web_delivery` entry (and the `claude_ai_hub_backend` gate). Each entry has `secret`, `hash` and `preload`; the files are served from `https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/`, with the entry at `<secret>-<hash>.js` and the preload chunks by name. Shared chunks they import (`shared-*.js`) are in the same place.
   The bootstrap also contains account data (email, UUIDs, Intercom JWT); don't share it.
2. **Compare accounts.** Diffing app_start between an old- and a new-experience account shows the gate, the extra bundle and the new UI strings ("Chat and Cowork unified", "New chat engine", "chats that have run on Anthropic's cloud", "Verify this device").
3. **Find the tool path.** Search the hub chunks for stable strings, not minified names:
   - `ConversationService` / `PerformActionRequest` / `client_tools` — protobuf descriptors
   - `localName==="clientTools"` — where declarations are copied into the request
   - `hostedBy==="desktop"` — the declaration builder that picks local tools
   - `omitServer` — the caller that decides whether local servers are dropped
   - `claudeAppBindings` and the `claude(nest|gov)?\/` regex — the desktop check
4. **Follow imports.** Minified names are local to each chunk; resolve them through the chunk's `import{a as b}from"./file.js"` statements before reading a definition.

Where things were in the 2026-11-05 build (`gated_imports_build_id` `9f9f2a4beb`):

| What | Chunk | Minified name |
|---|---|---|
| Caller with `omitServer` and the desktop check | `f2bbe5b0…-B5nDzWeM.js` | `xn` (imported as `Gx`) |
| Declaration builder (`hostedBy==="desktop"`) | `63e1be79…-B2fyN8Rp.js` | `nh` (exported as `xd`) |
| Desktop check (`Gx`) | `shared-l-p-m-w-1-CL3efpaA.js` | `Gx` |
| User agent + `claudeAppBindings` test | `shared-l-p-m-w-0-zzAmVzUa.js` | `U6`, `tG` |
| Local server filter (not built-in, not plugin, not Chrome extension) | `shared-p-m-0-CstnVOlW.js` | `lB`, `M_` |
| Protobuf descriptors (`PerformActionRequest`, `ConversationService`) | `2445b997…-CUWXkOHw.js` | — |
| Descriptor with the `client_tools` field | `2445b997…-CUWXkOHw.js` | — |

## Timeline

| Date | Event |
|---|---|
| 2026-11-03 | A user reported that claudeFS works on an old-experience account but not on a new-experience one, with detailed logs (handshake OK, no `tools/call`, small PerformAction bodies). |
| 2026-11-04 | First look at the frontend loaded by an old-experience account: session-based MCP code and `ClientToolCall` were present, but `PerformAction` was not, so the new experience had to be a separate bundle. Asked the reporter for the script list. |
| 2026-11-04 | The reporter sent app_start files from both accounts, which exposed `claude_ai_hub_web_delivery`. |
| 2026-11-05 | Traced the hub bundle to the `omitServer` / desktop check described above. Pushed `experiment/new-experience` with the shim and diagnostics, and sent the reporter a test link. |
| 2026-11-05 | Tested on a new-experience account. Hit the "Upgrade your app" wall at version 0.1.0; raised the shim version to 0.383.0 and it cleared. Tools then reached the model: 23.5 KB PerformAction with all 21 tools, 7 successful tool calls. Fix confirmed working. |
