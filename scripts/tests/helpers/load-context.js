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

function loadContext(relativeFiles) {
  const sandboxGlobal = {};
  sandboxGlobal.self = sandboxGlobal;
  // 一个干净的 vm context 不会自带 Node 的额外全局对象（TextDecoder/TextEncoder 等 WHATWG
  // API 不是 ECMAScript 内置，Uint8Array 之类才是）；read-file.js/read-file-lines.js 的
  // 流式读取用 TextDecoder，append-file.js 算字节长度用 TextEncoder，这里显式注入。
  sandboxGlobal.TextDecoder = TextDecoder;
  sandboxGlobal.TextEncoder = TextEncoder;
  const ctx = vm.createContext(sandboxGlobal);
  for (const rel of relativeFiles) {
    const filePath = path.join(SRC_DIR, rel);
    const src = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(src, ctx, { filename: rel });
  }
  return sandboxGlobal;
}

module.exports = { loadContext, SRC_DIR };
