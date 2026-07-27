// scripts/check-file-pairs-sync.js
// 手动跑的同步校验：core/ 下有几对 MAIN/ISOLATED 文件因为 Chrome 的同路径注入坑
// （见 core/fs/handle-store.js 头部注释）必须维护两份，这个脚本检查它们有没有在
// 该同步的部分跑偏。用 `node scripts/check-file-pairs-sync.js` 手动跑，不接入 CI/hook
// （改这类文件本就低频，靠手动记得跑；成对文件列表变化时改下面的 PAIRS）。
//
// 两种校验模式：
//   - 'identical'：去掉整份文件的行注释（// 开头的整行）后必须逐字相同。适用于两份
//     文件本该是同一份代码的复制（比如 handle-store.js/.isolated.js）。
//   - 'functions'：只比对指定的具名函数体（用 `function name(...) { ... }` 匹配到配对
//     的右花括号），其余部分允许不同。适用于两份文件共享一部分逻辑、但其中一侧有
//     额外的单向逻辑（比如 bridge.isolated.js 比 bridge.js 多一段建桥重试）。
//
// 这不是变量名的字符串替换 diff——两侧函数名相同即可配对比较，顺序不要求一致。
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

const PAIRS = [
  {
    a: 'core/fs/handle-store.js',
    b: 'core/fs/handle-store.isolated.js',
    mode: 'identical'
  },
  {
    a: 'core/bridge.js',
    b: 'core/bridge.isolated.js',
    mode: 'functions',
    functions: ['dispatch', 'flushOutbox', 'send', 'onMessage'],
    // 具名函数比对堵不住"协议字符串本身漂移"这个盲区——比如一侧把 'claudefs-bridge-ack'
    // 悄悄改成了别的字面量，两侧函数体各自内部依然自洽（改动者可能两边都手动改了但打错
    // 字），functions 模式不会报错，因为它不比较跨文件的字面量集合是否一致。这里单独把
    // 两侧所有 'claudefs-bridge-*' 协议字符串各收集成一个集合，断言两个集合相等。
    protocolLiteralPrefix: 'claudefs-bridge-'
  }
];

function stripLineComments(src) {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .trim();
}

// 提取形如 `function name(...) {` 开始、到配对的 `}` 结束的函数体全文
// （用花括号计数找配对右括号，不依赖缩进）。找不到该函数名时返回 null。
function extractFunctionSource(src, name) {
  const startRe = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const match = startRe.exec(src);
  if (!match) return null;

  let depth = 0;
  let i = match.index + match[0].length - 1; // 指向开头那个 '{'
  const start = match.index;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }
  return null; // 括号不配对，视为找不到
}

function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// 收集源码里所有 'prefix...' 形状的单引号字符串字面量（协议消息类型这类常量），
// 返回排序去重后的数组，方便跨文件比较集合是否相等。
function collectStringLiterals(src, prefix) {
  const re = new RegExp(`'(${prefix}[^']*)'`, 'g');
  const found = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found).sort();
}

function checkProtocolLiterals(pair, srcA, srcB) {
  const litsA = collectStringLiterals(srcA, pair.protocolLiteralPrefix);
  const litsB = collectStringLiterals(srcB, pair.protocolLiteralPrefix);
  const onlyInA = litsA.filter((l) => !litsB.includes(l));
  const onlyInB = litsB.filter((l) => !litsA.includes(l));
  if (onlyInA.length === 0 && onlyInB.length === 0) {
    return { ok: true, detail: `协议字符串集合一致：${litsA.join(', ') || '(空)'}` };
  }
  const problems = [];
  if (onlyInA.length > 0) problems.push(`只在 ${pair.a} 出现：${onlyInA.join(', ')}`);
  if (onlyInB.length > 0) problems.push(`只在 ${pair.b} 出现：${onlyInB.join(', ')}`);
  return { ok: false, detail: problems.join('；') };
}

function checkIdentical(pair, srcA, srcB) {
  const strippedA = stripLineComments(srcA);
  const strippedB = stripLineComments(srcB);
  if (strippedA === strippedB) {
    return { ok: true, detail: '去掉行注释后逐字相同' };
  }
  return {
    ok: false,
    detail: `去掉行注释后不一致（${pair.a} 共 ${strippedA.length} 字符，${pair.b} 共 ${strippedB.length} 字符）——请手动 diff 这两个文件`
  };
}

function checkFunctions(pair, srcA, srcB) {
  const problems = [];
  for (const name of pair.functions) {
    const fnA = extractFunctionSource(srcA, name);
    const fnB = extractFunctionSource(srcB, name);
    if (fnA === null) {
      problems.push(`${pair.a} 里找不到函数 ${name}()`);
      continue;
    }
    if (fnB === null) {
      problems.push(`${pair.b} 里找不到函数 ${name}()`);
      continue;
    }
    if (normalizeWhitespace(fnA) !== normalizeWhitespace(fnB)) {
      problems.push(`函数 ${name}() 两侧实现不一致`);
    }
  }
  if (problems.length === 0) {
    return { ok: true, detail: `共享函数一致：${pair.functions.join(', ')}` };
  }
  return { ok: false, detail: problems.join('；') };
}

function main() {
  let anyFail = false;

  for (const pair of PAIRS) {
    const pathA = path.join(SRC_DIR, pair.a);
    const pathB = path.join(SRC_DIR, pair.b);
    const srcA = fs.readFileSync(pathA, 'utf8');
    const srcB = fs.readFileSync(pathB, 'utf8');

    const results = [
      { mode: pair.mode, result: pair.mode === 'identical' ? checkIdentical(pair, srcA, srcB) : checkFunctions(pair, srcA, srcB) }
    ];
    if (pair.protocolLiteralPrefix) {
      results.push({ mode: 'protocol-literals', result: checkProtocolLiterals(pair, srcA, srcB) });
    }

    for (const { mode, result } of results) {
      const label = `${pair.a} <-> ${pair.b} [${mode}]`;
      if (result.ok) {
        console.log(`  ✓ ${label}`);
        console.log(`    ${result.detail}`);
      } else {
        console.error(`  ✗ ${label}`);
        console.error(`    ${result.detail}`);
        anyFail = true;
      }
    }
  }

  console.log('');
  if (anyFail) {
    console.error('存在漂移，请核对上面标 ✗ 的文件对。');
    process.exit(1);
  } else {
    console.log('全部成对文件同步一致。');
  }
}

main();
