// scripts/tests/desktop-shim.test.js
// node scripts/tests/desktop-shim.test.js
//
// Tests for the claude.ai new-experience support: adapters/claude/desktop-shim.js and the
// opt-in switch in adapters/claude/debug.js. Each case runs the scripts in a fresh vm
// context with a minimal fake browser (navigator, window, localStorage, location).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { runTests } = require('./helpers/mini-test');

const SRC = path.join(__dirname, '..', '..', 'src', 'adapters', 'claude');
const SHIM = fs.readFileSync(path.join(SRC, 'desktop-shim.js'), 'utf8');
const DEBUG = fs.readFileSync(path.join(SRC, 'debug.js'), 'utf8');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
// The same check claude.ai uses to recognise a desktop user agent.
const DESKTOP_TOKEN = /claude(nest|gov)?\/([^ ]+)/i;

function makeBrowser({ pathname = '/new', ua = CHROME_UA, storage = {}, bindings } = {}) {
  class Navigator {}
  Object.defineProperty(Navigator.prototype, 'userAgent', {
    configurable: true,
    enumerable: true,
    get() {
      return ua;
    }
  });
  const timers = [];
  const ctx = {
    Navigator,
    navigator: new Navigator(),
    console: { log() {} },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null)
    },
    location: {
      pathname,
      reloads: 0,
      reload() {
        this.reloads++;
      }
    },
    setInterval(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearInterval(id) {
      timers[id - 1] = null;
    },
    fetch: function originalFetch() {
      return Promise.resolve({});
    }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  if (bindings) ctx.claudeAppBindings = bindings;
  vm.createContext(ctx);
  // Runs every pending interval callback once, like one tick of the 500 ms timer.
  ctx.__tick = () => timers.forEach((fn) => fn && fn());
  return ctx;
}

function run(ctx, code) {
  vm.runInContext(code, ctx);
  return ctx;
}

function reportedVersion(ctx) {
  const m = ctx.navigator.userAgent.match(DESKTOP_TOKEN);
  return m ? m[2] : null;
}

async function main() {
  await runTests([
    [
      'shim: on an app page, adds a Claude/ token and a claudeAppBindings stub',
      async () => {
        const ctx = run(makeBrowser(), SHIM);
        assert.strictEqual(reportedVersion(ctx), '0.383.0');
        assert.ok(ctx.navigator.userAgent.startsWith(CHROME_UA));
        assert.strictEqual(typeof ctx.claudeAppBindings.registerBinding, 'function');
        assert.strictEqual(typeof ctx.claudeAppBindings.unregisterBinding, 'function');
        assert.strictEqual(ctx.claudeAppBindings.registerBinding('cmdK', () => {}), undefined);
      }
    ],
    [
      'shim: reported version is above the 2026-11-05 upgrade-wall floor (<0.3.0 is blocked)',
      async () => {
        const ctx = run(makeBrowser(), SHIM);
        const [major, minor] = reportedVersion(ctx).split('.').map(Number);
        assert.ok(major > 0 || minor >= 3, `version ${reportedVersion(ctx)} would hit the upgrade wall`);
      }
    ],
    [
      'shim: does not add a second token when run twice',
      async () => {
        const ctx = run(run(makeBrowser(), SHIM), SHIM);
        assert.strictEqual(ctx.navigator.userAgent.match(/Claude\//g).length, 1);
      }
    ],
    [
      'shim: leaves a real desktop user agent and real bindings untouched',
      async () => {
        const real = { registerBinding() {}, unregisterBinding() {}, real: true };
        const ua = `${CHROME_UA} Claude/1.2.3`;
        const ctx = run(makeBrowser({ ua, bindings: real }), SHIM);
        assert.strictEqual(ctx.navigator.userAgent, ua);
        assert.strictEqual(ctx.claudeAppBindings, real);
      }
    ],
    [
      'shim: localStorage claudefs.desktopShim=off disables it',
      async () => {
        const ctx = run(makeBrowser({ storage: { 'claudefs.desktopShim': 'off' } }), SHIM);
        assert.strictEqual(reportedVersion(ctx), null);
        assert.strictEqual(ctx.claudeAppBindings, undefined);
      }
    ],
    [
      'shim: localStorage claudefs.desktopShimVersion overrides the version',
      async () => {
        const ctx = run(makeBrowser({ storage: { 'claudefs.desktopShimVersion': '1.0.0' } }), SHIM);
        assert.strictEqual(reportedVersion(ctx), '1.0.0');
      }
    ],
    [
      'shim: does nothing on sign-in pages',
      async () => {
        for (const p of ['/login', '/login/verify-device', '/logout', '/magic-link', '/sso-callback/x', '/oauth/authorize', '/onboarding', '/verify', '/invites']) {
          const ctx = run(makeBrowser({ pathname: p }), SHIM);
          assert.strictEqual(reportedVersion(ctx), null, p);
          assert.strictEqual(ctx.claudeAppBindings, undefined, p);
        }
      }
    ],
    [
      'shim: reloads once when the address leaves the sign-in pages',
      async () => {
        const ctx = run(makeBrowser({ pathname: '/login' }), SHIM);
        ctx.__tick();
        assert.strictEqual(ctx.location.reloads, 0, 'no reload while still on /login');
        ctx.location.pathname = '/magic-link';
        ctx.__tick();
        assert.strictEqual(ctx.location.reloads, 0, 'no reload between sign-in pages');
        ctx.location.pathname = '/new';
        ctx.__tick();
        assert.strictEqual(ctx.location.reloads, 1);
        ctx.location.pathname = '/chat/abc';
        ctx.__tick();
        assert.strictEqual(ctx.location.reloads, 1, 'only once');
      }
    ],
    [
      'shim: paths that only start like a sign-in path are app pages',
      async () => {
        const ctx = run(makeBrowser({ pathname: '/login-help' }), SHIM);
        assert.strictEqual(reportedVersion(ctx), '0.383.0');
      }
    ],
    [
      'debug: off by default — no reporting API, fetch untouched, helper explains how to enable',
      async () => {
        const ctx = makeBrowser();
        const originalFetch = ctx.fetch;
        run(ctx, DEBUG);
        assert.strictEqual(ctx.ClaudefsDebug, undefined);
        assert.strictEqual(ctx.fetch, originalFetch);
        assert.ok(/claudefs\.debug/.test(ctx.claudefsDebug()));
        // The shim still works without the reporting API.
        run(ctx, SHIM);
        assert.strictEqual(reportedVersion(ctx), '0.383.0');
      }
    ],
    [
      'debug: on with localStorage claudefs.debug=on — reporting API and fetch observer installed',
      async () => {
        const ctx = makeBrowser({ storage: { 'claudefs.debug': 'on' } });
        const originalFetch = ctx.fetch;
        run(ctx, DEBUG);
        assert.strictEqual(typeof ctx.ClaudefsDebug.shim, 'function');
        assert.notStrictEqual(ctx.fetch, originalFetch);
        run(ctx, SHIM);
        assert.strictEqual(typeof ctx.claudefsDebug, 'function');
        assert.strictEqual(reportedVersion(ctx), '0.383.0');
      }
    ]
  ]);
}

main();
