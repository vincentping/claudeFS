// core/fs/glob.js — 宿主无关。
// 官方 server-filesystem 用 npm 包 minimatch 做 glob 排除；本项目没有构建步骤、不引入
// npm 依赖，这里自己写一个覆盖常见场景的最小实现（`*`、`**`、`?`），只对齐行为，不抄实现。
(function () {
  // 用官方 v2026.7.4 依赖的真实 minimatch 实测过 `**/` 的语义：`**/*.txt` 不仅匹配嵌套
  // 文件（"src/foo.txt"），也匹配根目录下的文件本身（"foo.txt"）——`**/` 代表"零层或多层
  // 目录前缀"，不是"至少一层"。这里把 `**` 紧跟 `/` 的组合整体转成 `(?:.*/)?`（可选的、
  // 以斜杠结尾的前缀）来还原这个语义；`**` 不紧跟 `/`（比如出现在 pattern 末尾）时维持原来
  // 的 `.*`，不受影响。
  function globToRegExp(glob) {
    let re = '';
    let i = 0;
    while (i < glob.length) {
      const c = glob[i];
      if (c === '*' && glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else if (c === '*') {
        re += '[^/]*';
        i++;
      } else if (c === '?') {
        re += '[^/]';
        i++;
      } else if ('.+^${}()|[]\\'.includes(c)) {
        re += '\\' + c;
        i++;
      } else {
        re += c;
        i++;
      }
    }
    return new RegExp(`^${re}$`);
  }

  function matchOne(relativePath, pattern) {
    return globToRegExp(pattern).test(relativePath);
  }

  // 与官方 directory_tree 的 excludePatterns 行为对齐：不带通配符的 pattern 按"任意深度的
  // 这一段名字"处理（精确匹配 / 作为路径前缀 / 作为路径中间某一段都算命中），带通配符的
  // 按字面 glob 匹配。
  function matchesAny(relativePath, patterns) {
    return patterns.some((pattern) => {
      if (pattern.includes('*') || pattern.includes('?')) {
        return matchOne(relativePath, pattern);
      }
      return (
        matchOne(relativePath, pattern) ||
        matchOne(relativePath, `**/${pattern}`) ||
        matchOne(relativePath, `**/${pattern}/**`)
      );
    });
  }

  // 与官方 search_files 的 pattern/excludePatterns 行为对齐：单次锚定匹配，不做
  // matchesAny 那种"任意深度兜底"——不带通配符的字面量必须整段等于 relativePath 才算命中
  // （和真实 minimatch 行为一致，已用官方 v2026.7.4 依赖的 minimatch 实测确认，见
  // search-files.js 顶部注释）。
  function matchGlob(relativePath, pattern) {
    return matchOne(relativePath, pattern);
  }

  // grep_files 专用（D12 扩展工具，契约自定，不跟随 search_files 的路径锚定语义，见
  // docs/archives/20260715_review_1.md P1a）：pattern 不含 "/" 时按 basename 匹配——天然做到"任意
  // 深度"，不需要改写正则加 "**/" 前缀，且和 ripgrep --glob 的直觉一致（`*.md` 搜全项目而
  // 不是只搜根目录）；pattern 含 "/" 时按完整相对路径锚定匹配（比如 "src/*.js" 只命中 src
  // 这一层，"**/*.md" 则是用户显式要求任意深度，交给 globToRegExp 的 "**/" 处理）。分流只看
  // pattern 是否含 "/"，不按通配符种类（*/**/?）分叉——`?.md` 同样走 basename 分支。
  function matchBasenameOrPath(relativePath, pattern) {
    if (pattern.includes('/')) {
      return matchOne(relativePath, pattern);
    }
    const segments = relativePath.split('/');
    const basename = segments[segments.length - 1];
    return matchOne(basename, pattern);
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.fs = self.ClaudefsCore.fs || {};
  self.ClaudefsCore.fs.glob = { matchesAny, matchGlob, matchBasenameOrPath };
})();
