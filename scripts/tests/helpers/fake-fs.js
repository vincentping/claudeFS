// scripts/tests/helpers/fake-fs.js
// 内存里模拟一棵 FileSystemDirectoryHandle/FileSystemFileHandle 树，实现今天新增工具
// 用到的那部分 File System Access API 表面（entries/getDirectoryHandle/getFileHandle/
// getFile/createWritable/removeEntry/stream），好让 core/fs/sandbox.js、core/fs/glob.js、
// core/fs/binary-detect.js 的真实实现可以原样跑在 Node 里，不用逐个工具单独 mock。
//
// tree 形状：普通 JS 对象。值为字符串或 Buffer 表示文件内容；值为 { __dir: true, children: {...} }
// 表示目录。用 makeRootHandle(tree) 拿到根目录 handle。
//
// createWritable 支持两种调用方式（2026-07-16 为 append_file/copy_file 扩展，工具增强批次 v2）：
//   - write(data)：整体覆盖写（write-file.js / replace-lines.js / move-file.js 等原有用法）。
//   - write({ type: 'write', position, data })：定位写，配合 { keepExistingData: true } 打开
//     （append_file 用来在文件尾追加，不整读进内存）。定位写只在 keepExistingData 模式下支持，
//     与真实浏览器实现一致（不 keepExistingData 时 createWritable 会先把文件截断成空）。
//
// lastModified 是"内容版本号"，不是墙钟时间（2026-07-16 为 read-tracker.js 的写前冲突检测
// 扩展）：每个 parentObj 用 WeakMap 维护一份 name -> mtime，只在真正写盘（close()）或测试
// 显式调用 bumpMtime() 模拟"外部修改"时才递增；同一份内容反复 getFile() 拿到的 mtime
// 保持不变，这才符合真实 File System Access API 的语义（也是 read-tracker 能被正确测试的
// 前提——如果每次 getFile() 都换一个新 mtime，任何写入前的二次读取都会被误判为外部修改）。
const { Buffer } = require('buffer');

const mtimeStores = new WeakMap(); // parentObj -> Map(name -> mtime)
let mtimeCounter = 1;

function getMtimeStore(parentObj) {
  let store = mtimeStores.get(parentObj);
  if (!store) {
    store = new Map();
    mtimeStores.set(parentObj, store);
  }
  return store;
}

function getMtime(parentObj, name) {
  const store = getMtimeStore(parentObj);
  if (!store.has(name)) store.set(name, mtimeCounter++);
  return store.get(name);
}

function bumpMtime(parentObj, name) {
  getMtimeStore(parentObj).set(name, mtimeCounter++);
}

// 测试用：模拟"文件在外部被修改"（不经过本模块的 createWritable，直接改内容 + 推进 mtime），
// 供 read-tracker 冲突检测的用例驱动（见 write-file.test.js 等）。
function simulateExternalEdit(tree, name, newContent) {
  tree[name] = newContent;
  bumpMtime(tree, name);
}

function toBuffer(content) {
  return Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
}

function makeFile(name, content, parentObj) {
  const buf = toBuffer(content);
  return {
    name,
    size: buf.length,
    lastModified: getMtime(parentObj, name),
    async text() {
      return buf.toString('utf8');
    },
    async arrayBuffer() {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    slice(start, end) {
      const s = buf.slice(start, end === undefined ? buf.length : end);
      return {
        async arrayBuffer() {
          return s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength);
        },
        async text() {
          return s.toString('utf8');
        }
      };
    },
    stream() {
      let offset = 0;
      const chunkSize = 64 * 1024;
      const reader = {
        async read() {
          if (offset >= buf.length) return { done: true, value: undefined };
          const end = Math.min(offset + chunkSize, buf.length);
          const chunk = new Uint8Array(buf.slice(offset, end));
          offset = end;
          return { done: false, value: chunk };
        },
        async cancel() {}
      };
      return {
        getReader() {
          return reader;
        },
        // copy_file 用 sourceFile.stream().pipeTo(destWritable) 流式直拷（不整读进内存）。
        // FileSystemWritableFileStream（createWritable() 的返回值）本身就有 write/close，
        // 真实浏览器里它同时也是合法的 WritableStream sink，这里直接按此形状写 pipeTo。
        async pipeTo(writable) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
          }
          await writable.close();
        }
      };
    }
  };
}

function isDirNode(v) {
  return v && typeof v === 'object' && v.__dir === true;
}

function notFound(name) {
  const e = new Error(`not found: ${name}`);
  e.name = 'NotFoundError';
  return e;
}

function typeMismatch(name) {
  const e = new Error(`type mismatch: ${name}`);
  e.name = 'TypeMismatchError';
  return e;
}

function makeFileEntryHandle(name, parentObj) {
  return {
    kind: 'file',
    name,
    async getFile() {
      return makeFile(name, parentObj[name], parentObj);
    },
    async createWritable(options) {
      const keepExisting = !!(options && options.keepExistingData);
      // 不 keepExistingData 时（默认），和真实浏览器一样立刻截断成空文件；
      // 整体覆盖写（旧用法）在 write() 里再把 buffer 换成新内容即可。
      let buf = keepExisting ? toBuffer(parentObj[name] === undefined ? '' : parentObj[name]) : Buffer.alloc(0);
      // 真实 FileSystemWritableFileStream 的 write(data)（不带 {type:'write', position}）
      // 是"在当前游标处写入并推进游标"，不是"整体替换"——copy_file 用 stream().pipeTo()
      // 逐块调用 write(chunk) 时依赖这个语义才能把多个 chunk 依次追加而不是互相覆盖。
      // 游标从 0 开始（不管 keepExistingData，都是"从头开始顺序写"这条路径的起点）。
      let cursor = 0;

      function ensureCapacity(end) {
        if (end > buf.length) {
          const grown = Buffer.alloc(end);
          buf.copy(grown);
          buf = grown;
        }
      }

      return {
        async write(data) {
          if (data && typeof data === 'object' && !Buffer.isBuffer(data) && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data) && data.type === 'write') {
            const chunk = toBuffer(data.data);
            const position = data.position == null ? buf.length : data.position;
            ensureCapacity(position + chunk.length);
            chunk.copy(buf, position);
            cursor = position + chunk.length;
            return;
          }
          let chunk;
          if (Buffer.isBuffer(data)) {
            chunk = data;
          } else if (data instanceof ArrayBuffer) {
            chunk = Buffer.from(data);
          } else if (ArrayBuffer.isView(data)) {
            chunk = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
          } else {
            chunk = Buffer.from(String(data), 'utf8');
          }
          ensureCapacity(cursor + chunk.length);
          chunk.copy(buf, cursor);
          cursor += chunk.length;
          // 旧用法（write-file.js/replace-lines.js/move-file.js 等）只调用一次 write() 就
          // close()，等价于整体覆盖——这里额外截断到 cursor，保证新内容比旧内容短时不会
          // 残留旧内容的尾巴。多次调用 write()（copy_file 的流式场景）不会触发截断，因为
          // 每次都是 cursor 之后紧接着写，buf 长度始终等于已写入的总字节数。
          buf = buf.slice(0, cursor);
        },
        async close() {
          parentObj[name] = buf;
          bumpMtime(parentObj, name);
        }
      };
    }
  };
}

function makeDirHandle(nodeObj) {
  return {
    kind: 'directory',
    async *entries() {
      for (const name of Object.keys(nodeObj)) {
        const val = nodeObj[name];
        if (isDirNode(val)) {
          yield [name, makeDirHandle(val.children)];
        } else {
          yield [name, makeFileEntryHandle(name, nodeObj)];
        }
      }
    },
    async getDirectoryHandle(name, opts) {
      const existing = nodeObj[name];
      if (isDirNode(existing)) return makeDirHandle(existing.children);
      if (existing !== undefined) throw typeMismatch(name);
      if (opts && opts.create) {
        nodeObj[name] = { __dir: true, children: {} };
        return makeDirHandle(nodeObj[name].children);
      }
      throw notFound(name);
    },
    async getFileHandle(name, opts) {
      const existing = nodeObj[name];
      if (isDirNode(existing)) throw typeMismatch(name);
      if (existing !== undefined) return makeFileEntryHandle(name, nodeObj);
      if (opts && opts.create) {
        nodeObj[name] = '';
        return makeFileEntryHandle(name, nodeObj);
      }
      throw notFound(name);
    },
    async removeEntry(name) {
      if (!(name in nodeObj)) throw notFound(name);
      delete nodeObj[name];
    }
  };
}

function makeRootHandle(tree) {
  return makeDirHandle(tree);
}

module.exports = { makeRootHandle, simulateExternalEdit };
