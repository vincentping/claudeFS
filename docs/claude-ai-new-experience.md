# claude.ai new experience: claudeFS tools never reach the model

- Status: **fixed in claudeFS 0.2.0** — verified on new- and classic-experience accounts (2026-11-05)
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

This is a client-side gate. The server accepts `client_tools` from a browser tab once the page passes it (the HTTP `User-Agent` header is not changed by the shim); confirmed in testing.

## Fix (claudeFS 0.2.0)

claudeFS already impersonates the desktop shell's `mcp-server-connected` handshake. 0.2.0 extends that to the environment check with `src/adapters/claude/desktop-shim.js` (MAIN world, `document_start`, before claude.ai's scripts):

- appends ` Claude/<version>` to `navigator.userAgent` (skipped if a Claude token is already there)
- installs a no-op `window.claudeAppBindings` with `registerBinding` / `unregisterBinding` (skipped if the real one exists)
- leaves sign-in pages alone (`/login`, `/logout`, `/magic-link`, `/sso-callback`, `/oauth`, `/onboarding`, `/verify`, `/invites`): with a desktop user agent the login page switches to the "Claude for Windows" desktop sign-in flow, which can't be completed in a tab. Since the desktop check is made once per page load, the shim reloads the page once when the address leaves those pages without a full reload, so it applies after signing in.
- `localStorage.setItem('claudefs.desktopShim', 'off')` disables it; `claudefs.desktopShimVersion` overrides the version

It runs on every claude.ai page, for both the new and the classic experience. Telling them apart is possible only after app_start has loaded, which is too late for the check, so it would need a remembered flag plus a reload; since the classic experience showed no meaningful side effects (below), it was kept simple.

### Reported version

claude.ai shows a hard "Upgrade your app" wall to a desktop user agent whose version falls in a range disabled by the remote config `nest_version_info` (GrowthBook key `3659052604`, checked by `Ns()` in the main bundle; it was not present in the 2026-11-04 bootstrap). It exists to retire old desktop builds, so it only blocks versions below a floor. Measured on 2026-11-05: `0.1.0`, `0.1.9` and `0.2.0` are blocked; `0.3.0` and everything above it that was tried (up to `1.0.0`) pass, so the disabled range is effectively `<0.3.0`.

The shim reports `0.383.0`: a value well above that floor and the one the tools were verified with. It is not a real desktop app version (an earlier note claimed it came from app_start; it is actually the `lucide-react` version mentioned in a system prompt there). If the wall comes back after a claude.ai update, raise the default, or override at runtime with `localStorage.setItem('claudefs.desktopShimVersion', '…')`.

### Diagnostics

`src/adapters/claude/debug.js` is off by default. To collect a report: run `localStorage.setItem('claudefs.debug', 'on')` in the console on claude.ai, reload, reproduce the problem, then run `claudefsDebug()`. The report covers the shim state, detected experience, handshake, MCP call counts, and PerformAction body sizes with whether claudeFS tool names appear in them. It records no chat or file content and is never sent anywhere.

### Side effects and limits

- The page treats itself as the desktop app. Observed: a `cmdK` desktop binding is registered, and two small unlabeled web-only controls on the new-chat page no longer show. No device-verification, "Trusted folders" or upgrade screens appeared.
- The Chat / Cowork switch and "Chats and tasks" exist on plain claude.ai too; they are not caused by the shim.
- claudeFS works in **Chat** mode only. Cowork tasks run in Anthropic's cloud, where the browser's local folder isn't reachable, with or without the shim.
- It depends on claude.ai internals and can break with any frontend update, including a future bump to the minimum version behind the upgrade wall.

## Test results (2026-11-05)

**New experience** (reporter's account): the PerformAction request for the user's message was **23,544 bytes and carried all 21 claudeFS tool names** (before: 100–382 bytes with none). Claude made 7 claudeFS tool calls (`search_files`, `list_allowed_directories`, `list_directory`, `read_text_file`) and got results back. One `read_text_file` returned `ok:false` because Claude guessed a filename before searching; the folder had no readme.

**Classic experience** (maintainer's account): in Chat mode `list_allowed_directories`, `list_directory` and `read_text_file` all worked. Compared with the shim switched off, the UI was the same apart from the small controls noted above.

**Reporter's retest** on both of their accounts: the tools worked on both. They found that the login page turned into the "Claude for Windows" screen while the extension was on, which led to the sign-in handling above. Verified afterwards: with the extension on, the login page shows the normal Google / Apple / email options, and after signing in the page reloads once by itself with the shim and claudeFS active.

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
| 2026-11-05 | Traced the wall to the remote config `nest_version_info` and measured the floor by trying versions: `<0.3.0` is blocked. Kept 0.383.0 as a fixed default rather than resolving the version dynamically. |
| 2026-11-05 | Tested the classic experience (Chat mode works; no meaningful side effects). The reporter retested on both experiences and found the sign-in page problem; fixed by leaving sign-in pages alone and reloading once after sign-in. Released as 0.2.0. |
