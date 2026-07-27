// scripts/tests/create-directory.test.js
// node scripts/tests/create-directory.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { makeRootHandle } = require('./helpers/fake-fs');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/tools/create-directory.js'];

function setup(tree) {
  const root = loadContext(CORE_FILES);
  const rootHandle = makeRootHandle(tree);
  root.ClaudefsCore.fs.handleStore = { getCurrentHandle: () => rootHandle };
  return { create: root.ClaudefsCore.tools.create_directory.handler, tree };
}

async function main() {
  await runTests([
    [
      '创建单层目录',
      async () => {
        const { create, tree } = setup({});
        const result = await create({ path: 'foo' });
        assert.ok(result.content[0].text.includes('Successfully created directory foo'), result.content[0].text);
        assert.ok(tree.foo && tree.foo.__dir, 'foo 应该已经变成目录');
      }
    ],
    [
      '一次创建多级嵌套目录',
      async () => {
        const { create, tree } = setup({});
        await create({ path: 'a/b/c' });
        assert.ok(tree.a.__dir && tree.a.children.b.__dir && tree.a.children.b.children.c.__dir);
      }
    ],
    [
      '目录已存在时静默成功，不报错（官方 idempotent 行为），但返回文案要区分"已存在"而非"新建"',
      async () => {
        const { create } = setup({ foo: { __dir: true, children: {} } });
        const result = await create({ path: 'foo' });
        assert.ok(result.content[0].text.includes('already exists'), result.content[0].text);
        assert.ok(!result.content[0].text.includes('Successfully created'), result.content[0].text);
      }
    ],
    [
      '连续三次调用：新建 → 已存在 → 删后重建，各自文案正确（复现 2026-07-15 review 实测场景）',
      async () => {
        const { create, tree } = setup({});
        const first = await create({ path: 'test-tmp' });
        assert.ok(first.content[0].text.includes('Successfully created directory test-tmp'), first.content[0].text);

        const second = await create({ path: 'test-tmp' });
        assert.ok(second.content[0].text.includes('Directory test-tmp already exists'), second.content[0].text);

        delete tree['test-tmp'];
        const third = await create({ path: 'test-tmp' });
        assert.ok(third.content[0].text.includes('Successfully created directory test-tmp'), third.content[0].text);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
