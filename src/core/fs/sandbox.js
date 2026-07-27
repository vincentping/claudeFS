// core/fs/sandbox.js — 宿主无关。
// 把工具收到的 `path` 参数（相对已授权根目录）解析成对应的 FileSystemDirectoryHandle
// 或 FileSystemFileHandle。
//
// 真正的沙箱边界由浏览器内核保证，不是靠这里的字符串校验：getDirectoryHandle(name) 只会
// 把 name 当字面量子目录名去查自己的直接子项，不认识 ".."/"." 这些特殊含义，就算完全不
// 做任何校验，传 ".." 也只会因为"没有一个真的叫 .. 的子目录"报 NotFoundError，不可能真的
// 跳出授权目录。这里的绝对路径/盘符拒绝纯粹是为了在
// 更早的地方给出更清晰的错误信息，属于报错质量而不是安全修复。
(function () {
  function splitPath(path) {
    const raw = String(path == null ? '.' : path);

    if (raw.startsWith('/') || raw.startsWith('\\')) {
      throw new Error(`不允许绝对路径: ${raw}（path 应该是相对已连接文件夹的相对路径，比如 "." 或 "src/foo.js"）`);
    }
    if (/^[a-zA-Z]:/.test(raw)) {
      throw new Error(`不允许带盘符的路径: ${raw}（path 应该是相对已连接文件夹的相对路径）`);
    }

    // 先把 "\uF0XX" 转义序列还原成真实的 WSL 私有使用区字符（见 core/fs/name-escape.js
    // 顶部注释）——必须在下面的 "\\ → /" 分隔符归一化
    // 之前做：转义序列本身含字面 ASCII 反斜杠（"`\uF05C`" 这 8 个字符），如果先做分隔符
    // 归一化会把这个字面反斜杠也错当分隔符切开。还原之后，这条路径里如果本来就有真实的
    // 私有区字符（如真的 U+F05C），就不再是 ASCII "\\"，不会被下面的 replace 误伤。
    const unescaped = self.ClaudefsCore.fs.nameEscape.unescapeSpecialChars(raw);

    const normalized = unescaped.replace(/\\/g, '/');
    const segments = normalized.split('/').filter((seg) => seg !== '' && seg !== '.');

    if (segments.some((seg) => seg === '..')) {
      throw new Error(`非法路径，不允许越界访问授权目录之外: ${raw}`);
    }
    return segments;
  }

  // core/fs/read-tracker.js 用：把 path 的各种写法（"a/b.txt" / "a\\b.txt" / 转义序列）
  // 归一化成同一个 tracker key，复用这里已经写好的分隔符归一化 + 转义还原逻辑，不在
  // read-tracker.js 里重复一份路径解析。
  function normalizePathForTracking(path) {
    return splitPath(path).join('/');
  }

  // options.create：为 true 时，沿途和最终目录段都会 {create:true} 逐级创建（对齐
  // create_directory 需要的"递归创建、已存在不报错"语义）。不传 options 时行为和以前
  // 完全一致（不创建，找不到就 NotFoundError），所以是纯新增、不影响既有调用方。
  async function resolveDirectory(rootHandle, path, options) {
    const opts = options || {};
    const segments = splitPath(path);
    let current = rootHandle;
    for (const seg of segments) {
      current = await current.getDirectoryHandle(seg, { create: !!opts.create });
    }
    return current;
  }

  // 路径可能指向文件也可能指向目录，调用方（get_file_info、move_file）事先不知道是哪种。
  // File System Access API 没有一个通用的"getHandle"，只能先试 getFileHandle，命中
  // TypeMismatchError（该名字其实是目录）再退回 getDirectoryHandle；两者都失败则说明
  // 整个路径不存在，原样抛出（通常是 NotFoundError）。
  async function resolveEntry(rootHandle, path) {
    const segments = splitPath(path);
    if (segments.length === 0) {
      return { kind: 'directory', handle: rootHandle };
    }
    const name = segments[segments.length - 1];
    let current = rootHandle;
    for (const seg of segments.slice(0, -1)) {
      current = await current.getDirectoryHandle(seg);
    }
    try {
      const fileHandle = await current.getFileHandle(name);
      return { kind: 'file', handle: fileHandle };
    } catch (e) {
      if (e && e.name === 'TypeMismatchError') {
        const dirHandle = await current.getDirectoryHandle(name);
        return { kind: 'directory', handle: dirHandle };
      }
      throw e;
    }
  }

  // move_file 用："复制到新位置成功之后"删除源文件那一步。只删文件，不处理目录
  // （move_file 本身就不支持目录搬移，见 move-file.js 顶部注释）。
  async function removeFile(rootHandle, path) {
    const segments = splitPath(path);
    if (segments.length === 0) {
      throw new Error('path 不能指向根目录本身');
    }
    const fileName = segments[segments.length - 1];
    let current = rootHandle;
    for (const seg of segments.slice(0, -1)) {
      current = await current.getDirectoryHandle(seg);
    }
    await current.removeEntry(fileName);
  }

  // options.create：为 true 时，目标文件不存在就创建（getFileHandle 的 create:true 有个
  // 副作用——一旦调用就会立刻在磁盘上建一个空文件，哪怕调用方后面还没真的写内容。
  // 所以调用方（write_file）必须只在用户批准写入之后才传 create:true，批准之前用
  // 不带 create 的调用来判断文件是否已存在，绝不能在拿到批准前碰这个选项。
  // 中间目录始终不带 create（和 Node fs.writeFile 一样，不隐式建父目录）。
  async function resolveFile(rootHandle, path, options) {
    const opts = options || {};
    const segments = splitPath(path);
    if (segments.length === 0) {
      throw new Error('path 不能指向根目录本身，需要指定一个文件');
    }
    const fileName = segments[segments.length - 1];
    let current = rootHandle;
    for (const seg of segments.slice(0, -1)) {
      current = await current.getDirectoryHandle(seg);
    }
    return current.getFileHandle(fileName, { create: !!opts.create });
  }

  // rm_empty_dir 用：删除一个目录条目本身（调用方已确认该目录为空）。和 removeFile 结构
  // 一样，只是最后一段落在目录名上；`removeEntry` 不带 `{recursive:true}`——非空目录会
  // 报错而不是被递归删掉，这正是 rm_empty_dir "绝不递归删" 的兜底保障。
  async function removeDirectory(rootHandle, path) {
    const segments = splitPath(path);
    if (segments.length === 0) {
      throw new Error('path 不能指向根目录本身');
    }
    const dirName = segments[segments.length - 1];
    let current = rootHandle;
    for (const seg of segments.slice(0, -1)) {
      current = await current.getDirectoryHandle(seg);
    }
    await current.removeEntry(dirName);
  }

  self.ClaudefsCore = self.ClaudefsCore || {};
  self.ClaudefsCore.fs = self.ClaudefsCore.fs || {};
  self.ClaudefsCore.fs.sandbox = {
    resolveDirectory,
    resolveFile,
    resolveEntry,
    removeFile,
    removeDirectory,
    normalizePathForTracking
  };
})();
