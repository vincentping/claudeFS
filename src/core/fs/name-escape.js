// core/fs/name-escape.js — 宿主无关。
// 处理 WSL2 把 Windows 非法文件名字符（\ : < > " | ? *）编码进 Unicode 私有使用区
// U+F000–U+F0FF 的既定行为（Microsoft SFU/WSL 编码：私有区码点 = 0xF000 + 原 ASCII 字符
// 码点，例如 `\` U+005C → U+F05C，`:` U+003A → U+F03A）。
//
// 背景：这些私有区字符在大多数字体/渲染管线里不可见或被吞掉。`entries()` 会如实返回它们（没有丢字符），
// 但我们的工具若把这种 name 原样塞进文本输出，Claude 看到的"显示名"其实丢了信息——回传
// 给 delete_file 等工具时会构造出缺字符的版本，天然匹配不到文件。这不是浏览器限制，是
// "显示"和"回传"之间的保真度问题；本模块提供的转义/反转义就是补上这道保真度。
//
// escapeSpecialChars(name)：显示端用。把 U+F000–U+F0FF 范围内的码点替换成可见的
// "\uF0XX" 字面文本（8 个 ASCII 字符），其余字符原样保留。所有把 entries() 拿到的 name
// 输出给 Claude 的工具（list_directory / list_directory_with_sizes / directory_tree /
// search_files）都要在输出前过一遍这个函数。
//
// unescapeSpecialChars(text)：解析端用，只有 sandbox.js 的 splitPath 调用。把形如
// "\uF0XX"（XX 为两位十六进制）的转义序列还原成真实的私有区字符，供后续路径分段与
// getFileHandle/getDirectoryHandle 使用真名。
//
// 已知局限（转义方案的固有边界，接受，不处理）：如果用户的真实文件名恰好包含字面文本
// "\uF0XX"（8 个 ASCII 字符，且 XX 恰好是合法十六进制），unescape 会把它误当转义序列
// 还原成私有区字符。概率极低（8 字符字面量撞上 U+F000–U+F0FF 这个窄范围），且只出现在
// WSL 场景，本模块不做转义歧义的进一步消解。
(function () {
  const PRIVATE_USE_START = 0xf000;
  const PRIVATE_USE_END = 0xf0ff;

  function escapeSpecialChars(name) {
    let out = '';
    for (const ch of String(name)) {
      const code = ch.codePointAt(0);
      if (code >= PRIVATE_USE_START && code <= PRIVATE_USE_END) {
        out += `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
      } else {
        out += ch;
      }
    }
    return out;
  }

  const ESCAPE_PATTERN = /\\u([Ff]0[0-9A-Fa-f]{2})/g;

  function unescapeSpecialChars(text) {
    return String(text).replace(ESCAPE_PATTERN, (match, hex) => String.fromCodePoint(parseInt(hex, 16)));
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.fs = self.ClaudefsCore.fs || {};
  self.ClaudefsCore.fs.nameEscape = { escapeSpecialChars, unescapeSpecialChars };
})();
