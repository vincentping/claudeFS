// scripts/tests/edit-file.test.js
// 黑盒测试 core/tools/edit-file.js：没有构建/模块系统，src/ 全是浏览器全局挂载风格
// （self.ClaudefsCore.xxx = ...），所以用 vm 把源码加载进一个 stub 过的 self 环境里，
// 通过公开的 handler() 驱动，不改动生产代码结构。
// 用 `node scripts/tests/edit-file.test.js` 直接跑，没有测试框架依赖。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function makeFakeFile(content, root, { getMtime } = {}) {
  let currentContent = content;
  const fileHandle = {
    async getFile() {
      return {
        size: Buffer.byteLength(currentContent, 'utf8'),
        lastModified: getMtime ? getMtime() : 0,
        async text() {
          return currentContent;
        }
      };
    },
    async createWritable() {
      return {
        async write(text) {
          currentContent = text;
        },
        async close() {}
      };
    }
  };

  root.fs.sandbox.resolveFile = async () => fileHandle;
  return {
    getContent: () => currentContent
  };
}

async function run() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return fn()
      .then(() => {
        console.log(`  ✓ ${name}`);
        passed++;
      })
      .catch((err) => {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        failed++;
      });
  }

  // 每个用例独立加载一份工具（含独立的 ClaudefsCore 全局），避免 stub 状态串扰。
  function loadWithContext() {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'core', 'tools', 'edit-file.js'),
      'utf8'
    );
    const sandboxGlobal = {};
    sandboxGlobal.self = sandboxGlobal;
    sandboxGlobal.ClaudefsCore = { fs: { limits: { MAX_READ_BYTES: 5 * 1024 * 1024 } } };
    const ctx = vm.createContext(sandboxGlobal);
    vm.runInContext(src, ctx, { filename: 'edit-file.js' });
    return sandboxGlobal;
  }

  await test('自重叠 oldText 不应被过度计数 ("aa" in "aaaa" 应为 2 处而非 3 处，报错且不写盘)', async () => {
    const root = loadWithContext();
    root.ClaudefsCore.fs = root.ClaudefsCore.fs || {};
    root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => ({}) };
    root.ClaudefsCore.fs.sandbox = {};
    root.ClaudefsCore.diff = {
      computeLineDiff: () => [],
      formatDiffText: () => ''
    };
    root.ClaudefsCore.confirm = {
      requestConfirmation: async () => {
        throw new Error('不应该走到确认弹窗（应在匹配阶段就报错）');
      }
    };

    const file = makeFakeFile('aaaa', root.ClaudefsCore);

    let threw = false;
    try {
      await root.ClaudefsCore.tools.edit_file.handler({
        path: 'x.txt',
        edits: [{ oldText: 'aa', newText: 'bb' }]
      });
    } catch (err) {
      threw = true;
      assert.ok(
        err.message.includes('2 处'),
        `期望报错提到"2 处"（非重叠计数），实际信息: ${err.message}`
      );
    }
    assert.ok(threw, '"aa" 在 "aaaa" 中有 2 处非重叠匹配，应报错而不是静默替换');
    assert.strictEqual(file.getContent(), 'aaaa', '匹配不唯一时文件不应被写入');
  });

  await test('唯一匹配的 oldText 应正常替换并写盘', async () => {
    const root = loadWithContext();
    root.ClaudefsCore.fs = root.ClaudefsCore.fs || {};
    root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => ({}) };
    root.ClaudefsCore.fs.sandbox = {};
    root.ClaudefsCore.diff = {
      computeLineDiff: () => [],
      formatDiffText: () => 'diff'
    };
    root.ClaudefsCore.confirm = {
      requestConfirmation: async () => ({ approved: true })
    };
    root.ClaudefsCore.fs.readTracker = {
      checkConflict: () => null,
      recordWrite: () => {}
    };

    const file = makeFakeFile('hello world', root.ClaudefsCore);

    const result = await root.ClaudefsCore.tools.edit_file.handler({
      path: 'x.txt',
      edits: [{ oldText: 'world', newText: 'there' }]
    });

    assert.strictEqual(file.getContent(), 'hello there');
    assert.ok(result.content[0].text.length >= 0);
  });

  await test('非重叠但相邻的两处匹配应准确计为 2 处', async () => {
    const root = loadWithContext();
    root.ClaudefsCore.fs = root.ClaudefsCore.fs || {};
    root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => ({}) };
    root.ClaudefsCore.fs.sandbox = {};
    root.ClaudefsCore.diff = {
      computeLineDiff: () => [],
      formatDiffText: () => ''
    };
    root.ClaudefsCore.confirm = {
      requestConfirmation: async () => {
        throw new Error('不应该走到确认弹窗');
      }
    };

    // "abab" 中查找 "ab"：非重叠匹配应为 2 处（下标 0 和 2）。
    const file = makeFakeFile('abab', root.ClaudefsCore);

    let threw = false;
    try {
      await root.ClaudefsCore.tools.edit_file.handler({
        path: 'x.txt',
        edits: [{ oldText: 'ab', newText: 'X' }]
      });
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('2 处'), `实际信息: ${err.message}`);
    }
    assert.ok(threw);
  });

  await test('写前冲突检测：读后被外部修改 → 警示（不拦截，approved 后仍正常写盘）', async () => {
    const root = loadWithContext();
    root.ClaudefsCore.fs = root.ClaudefsCore.fs || {};
    root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => ({}) };
    root.ClaudefsCore.fs.sandbox = {};
    root.ClaudefsCore.diff = {
      computeLineDiff: () => [],
      formatDiffText: () => 'diff'
    };
    let lastPayload = null;
    root.ClaudefsCore.confirm = {
      requestConfirmation: async (payload) => {
        lastPayload = payload;
        return { approved: true };
      }
    };
    root.ClaudefsCore.fs.readTracker = {
      checkConflict: (path, currentMtime) => (currentMtime > 1000 ? '⚠ 该文件在上次读取后已被外部修改' : null),
      recordWrite: () => {}
    };

    const file = makeFakeFile('hello world', root.ClaudefsCore, { getMtime: () => 2000 });

    await root.ClaudefsCore.tools.edit_file.handler({
      path: 'x.txt',
      edits: [{ oldText: 'world', newText: 'there' }]
    });

    assert.ok(lastPayload.warning && lastPayload.warning.includes('外部修改'), JSON.stringify(lastPayload));
    assert.strictEqual(file.getContent(), 'hello there', '警示不拦截，approved 后应正常写盘');
  });

  await test('写前冲突检测：无基线（checkConflict 返回 null）→ 不警示', async () => {
    const root = loadWithContext();
    root.ClaudefsCore.fs = root.ClaudefsCore.fs || {};
    root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => ({}) };
    root.ClaudefsCore.fs.sandbox = {};
    root.ClaudefsCore.diff = {
      computeLineDiff: () => [],
      formatDiffText: () => 'diff'
    };
    let lastPayload = null;
    root.ClaudefsCore.confirm = {
      requestConfirmation: async (payload) => {
        lastPayload = payload;
        return { approved: true };
      }
    };
    root.ClaudefsCore.fs.readTracker = {
      checkConflict: () => null,
      recordWrite: () => {}
    };

    makeFakeFile('hello world', root.ClaudefsCore);
    await root.ClaudefsCore.tools.edit_file.handler({
      path: 'x.txt',
      edits: [{ oldText: 'world', newText: 'there' }]
    });

    assert.strictEqual(lastPayload.warning, undefined, JSON.stringify(lastPayload));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
