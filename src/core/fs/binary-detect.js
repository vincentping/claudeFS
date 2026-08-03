// core/fs/binary-detect.js — 宿主无关。
// 二进制文件嗅探（常见二进制扩展名 + 内容开头是否出现 NUL 字节，任一命中就判定为二进制），
// 供 read_file / read_text_file / grep_files / read_multiple_files / read_file_lines 复用
// （read-file.js 原先有一份独立实现，后合并到此处，见该文件头部注释）。
(function () {
  const BINARY_SNIFF_BYTES = 4096;

  const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico',
    'pdf', 'zip', 'gz', 'tar', '7z', 'rar',
    'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'wasm',
    'mp3', 'mp4', 'mov', 'avi', 'woff', 'woff2', 'ttf', 'otf'
  ]);

  // 共享给 read-media-file.js 的 MIME 推断复用，避免两处各写一份同样的扩展名切分逻辑。
  function getExtension(name) {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  }

  function hasBinaryExtension(name) {
    return BINARY_EXTENSIONS.has(getExtension(name));
  }

  async function sniffHasNulByte(file) {
    const sampleSize = Math.min(file.size, BINARY_SNIFF_BYTES);
    if (sampleSize === 0) return false;
    const buf = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());
    return buf.includes(0);
  }

  // 返回 null（不是二进制）或者一句可以直接拼进错误信息的说明文字。
  async function detectBinaryReason(file) {
    if (hasBinaryExtension(file.name)) {
      return `"${file.name}" 看起来是二进制文件（按扩展名判断）`;
    }
    if (await sniffHasNulByte(file)) {
      return `"${file.name}" 看起来是二进制文件（内容中出现 NUL 字节）`;
    }
    return null;
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.fs = self.ClaudefsCore.fs || {};
  self.ClaudefsCore.fs.binaryDetect = { hasBinaryExtension, sniffHasNulByte, detectBinaryReason, getExtension };
})();
