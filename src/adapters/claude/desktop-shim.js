// adapters/claude/desktop-shim.js — support for the claude.ai new experience
// (internally "hub"; messages go through PerformAction instead of /completion). MAIN world.
//
// Background: when the new frontend builds PerformActionRequest.client_tools, it only
// includes local MCP tools marked hostedBy:"desktop" if xn() is true (= it believes it is
// running inside the Claude desktop app). Otherwise it passes omitServer: () => true for
// every local server, so claudeFS's tools complete the handshake and show up in the UI but
// are never handed to the model.
//
// xn() (U6 in shared-l-p-m-w-0) requires both:
//   1. navigator.userAgent matches /claude(nest|gov)?\/([^ ]+)/i
//   2. window.claudeAppBindings exists
// The result is cached, so this must run before claude.ai's own scripts: keep this file at
// the top of the MAIN world content_scripts list (only debug.js may come before it, since
// debug.js doesn't read userAgent), with run_at: document_start.
//
// Switches (set in the DevTools console on claude.ai, take effect after a reload):
//   localStorage.setItem('claudefs.desktopShim', 'off')          // disable this shim
//   localStorage.setItem('claudefs.desktopShimVersion', 'x.y.z') // change the reported version
(function () {
  const TAG = '[claudefs:shim]';
  const log = (...args) => console.log(TAG, ...args);
  const dbg = self.ClaudefsDebug; // debug.js loads before this file; undefined in builds without it

  // claude.ai shows a hard "Upgrade your app" wall to any desktop user agent whose version
  // falls in a range disabled by the remote config "nest_version_info" (Ns() in the main
  // bundle). It is meant to retire old desktop builds, so it only blocks versions below some
  // floor. Measured on 2026-11-05: 0.2.0 and lower are blocked, 0.3.0 and higher pass.
  // 0.383.0 is just a value well above that floor, and the version the tools were verified
  // with end to end (it is not a real desktop app version). If the wall comes back after a
  // claude.ai update, raise this, or override at runtime with
  // localStorage.setItem('claudefs.desktopShimVersion', 'x.y.z').
  // xn() itself doesn't check the version; only the upgrade gate does.
  const DEFAULT_VERSION = '0.383.0';

  function readSetting(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  if (readSetting('claudefs.desktopShim') === 'off') {
    log('disabled via localStorage (claudefs.desktopShim=off)');
    if (dbg) dbg.shim({ disabled: true });
    return;
  }

  // Sign-in pages: with a desktop user agent, claude.ai's login page switches to the
  // "Claude for Windows" desktop sign-in flow, which can't be completed in a browser tab.
  // So don't patch anything on these pages. claude.ai decides whether it's the desktop app
  // once per page load, so after signing in, when the address leaves these pages without a
  // full reload (client-side navigation), reload once so the shim applies on the app pages.
  const AUTH_PATH = /^\/(login|logout|magic-link|sso-callback|oauth|onboarding|verify|invites)(\/|$)/;
  if (AUTH_PATH.test(location.pathname)) {
    log('sign-in page, not patching:', location.pathname);
    if (dbg) dbg.shim({ skipped: 'sign-in page' });
    const timer = setInterval(() => {
      if (AUTH_PATH.test(location.pathname)) return;
      clearInterval(timer);
      log('left the sign-in pages, reloading so the shim applies');
      if (dbg) dbg.shim({ reloadAfterSignIn: true });
      location.reload();
    }, 500);
    return;
  }

  const version = readSetting('claudefs.desktopShimVersion') || DEFAULT_VERSION;

  // 1. userAgent: append " Claude/<version>". The real desktop app already has this token,
  //    so it isn't added twice. This only changes the value seen by JS; the HTTP User-Agent
  //    header is unaffected.
  try {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
    const originalGet = desc && desc.get;
    const originalUA = originalGet ? originalGet.call(navigator) : navigator.userAgent;
    if (!/claude(nest|gov)?\/[^ ]+/i.test(originalUA)) {
      const spoofed = `${originalUA} Claude/${version}`;
      Object.defineProperty(Navigator.prototype, 'userAgent', {
        configurable: true,
        enumerable: desc ? desc.enumerable : true,
        get() {
          return spoofed;
        }
      });
      log('userAgent patched with', `Claude/${version}`);
      if (dbg) dbg.shim({ userAgentPatched: true, version });
    } else {
      log('userAgent already carries a Claude token, left untouched');
      if (dbg) dbg.shim({ userAgentPatched: 'already-present' });
    }
  } catch (err) {
    log('failed to patch userAgent:', err);
    if (dbg) dbg.shim({ userAgentPatched: false }), dbg.error('shim.userAgent', err);
  }

  // 2. claudeAppBindings: the frontend only calls registerBinding / unregisterBinding, both
  //    inside try/catch; when registerBinding returns undefined it calls unregisterBinding
  //    on cleanup instead. Left alone if the real desktop app already provides it.
  if (window.claudeAppBindings) {
    if (dbg) dbg.shim({ bindingsStub: 'real-desktop-bindings-present' });
  } else {
    try {
      Object.defineProperty(window, 'claudeAppBindings', {
        configurable: true,
        writable: true,
        value: {
          registerBinding(key) {
            // Record which desktop binding keys the frontend registers, to see which desktop-only paths ran
            if (dbg) dbg.registerBinding(key);
            return undefined;
          },
          unregisterBinding() {}
        }
      });
      log('claudeAppBindings stub installed');
      if (dbg) dbg.shim({ bindingsStub: true });
    } catch (err) {
      log('failed to install claudeAppBindings stub:', err);
      if (dbg) dbg.shim({ bindingsStub: false }), dbg.error('shim.bindings', err);
    }
  }
})();
