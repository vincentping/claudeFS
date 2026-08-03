// scripts/tests/helpers/load-context.js
// 把若干 src/core 下的源文件按顺序加载进同一个 vm context（模拟 manifest.json 里
// content_scripts 的加载顺序），返回那个 context 的全局对象（self.ClaudefsCore 挂在上面）。
// 用真实源码而不是 mock，是为了让 sandbox.js 的路径解析、glob.js 的匹配、
// binary-detect.js 的嗅探都用真实实现跑在测试里，只有最底层的"浏览器 FS 原语"
// （FileSystemDirectoryHandle 等）由 fake-fs.js 模拟。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.join(__dirname, '..', '..', '..', 'src');

// 一个干净的 vm context 不会自带 Node 的额外全局对象（这几个 WHATWG API 不是 ECMAScript
// 内置，Uint8Array 之类才是）；read-file.js/read-file-lines.js 的流式读取用 TextDecoder，
// append-file.js 算字节长度用 TextEncoder，read-media-file.js 编码 base64 用 btoa——需要哪个
// 就加进这个集合，不用在 loadContext 里逐条手写赋值。
const BROWSER_GLOBALS_FOR_TESTS = { TextDecoder, TextEncoder, btoa };

function loadContext(relativeFiles) {
  const sandboxGlobal = {};
  sandboxGlobal.self = sandboxGlobal;
  Object.assign(sandboxGlobal, BROWSER_GLOBALS_FOR_TESTS);
  const ctx = vm.createContext(sandboxGlobal);
  for (const rel of relativeFiles) {
    const filePath = path.join(SRC_DIR, rel);
    const src = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(src, ctx, { filename: rel });
  }
  return sandboxGlobal;
}

module.exports = { loadContext, SRC_DIR };
