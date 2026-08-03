// scripts/tests/output-schema.test.js
// node scripts/tests/output-schema.test.js
// 覆盖性断言：21 个工具文件手工逐个补 outputSchema，漏一个不会
// 有任何报错、也不会有任何其它测试变红——这里遍历全部注册逐个核对，兜住这个空档。
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { runTests } = require('./helpers/mini-test');

// core/tools/* 全部 21 个文件（22 个注册，read-file.js 注册两个），只依赖 fs 层，
// 不依赖 bridge/confirm/dispatch，加载顺序与 manifest.json 里 core/tools/* 段一致。
const CORE_FILES = [
  'core/fs/name-escape.js',
  'core/fs/sandbox.js',
  'core/fs/glob.js',
  'core/fs/binary-detect.js',
  'core/fs/default-excludes.js',
  'core/fs/limits.js',
  'core/fs/handle-store.js',
  'core/fs/read-tracker.js',
  'core/tools/list-directory.js',
  'core/tools/list-directory-with-sizes.js',
  'core/tools/list-allowed-directories.js',
  'core/tools/read-file.js',
  'core/tools/read-media-file.js',
  'core/tools/read-multiple-files.js',
  'core/tools/read-file-lines.js',
  'core/tools/directory-tree.js',
  'core/tools/search-files.js',
  'core/tools/grep-files.js',
  'core/tools/get-file-info.js',
  'core/tools/create-directory.js',
  'core/tools/write-file.js',
  'core/tools/edit-file.js',
  'core/tools/replace-lines.js',
  'core/tools/insert-lines.js',
  'core/tools/move-file.js',
  'core/tools/copy-file.js',
  'core/tools/append-file.js',
  'core/tools/delete-file.js',
  'core/tools/rm-empty-dir.js'
];

const EXPECTED_OUTPUT_SCHEMA = {
  type: 'object',
  properties: { content: { type: 'string' } },
  required: ['content']
};

// read_media_file 是唯一的例外：输出是 content block 数组（image/audio/resource），
// 不是其余 21 个工具共用的 { content: string } 形状——它读的是二进制媒体，天然不能套用
// 文本工具的输出契约。这里只断言它确实是数组形状，不强行拉平成同一份共享常量。

async function main() {
  await runTests([
    [
      '全部 22 个工具注册都有 outputSchema，21 个文本工具与共享形状一致，read_media_file 单独核对',
      async () => {
        const root = loadContext(CORE_FILES);
        const tools = root.ClaudefsCore.tools;
        const names = Object.keys(tools);
        assert.strictEqual(names.length, 22, `期望 22 个注册，实际 ${names.length}：${names.join(',')}`);
        for (const name of names) {
          const outputSchema = tools[name].definition.outputSchema;
          assert.ok(outputSchema, `${name} 缺少 outputSchema`);
          if (name === 'read_media_file') {
            // 断言 content 是数组即已经证明它偏离了共享的 { content: string } 形状
            // （EXPECTED_OUTPUT_SCHEMA 要求 content 是字符串），不需要再单独断言两者不相等。
            assert.strictEqual(outputSchema.properties.content.type, 'array', 'read_media_file 的 content 应为数组（content block 列表），不是字符串');
            continue;
          }
          // 工具在 vm sandbox context 里加载，对象跨 realm，deepStrictEqual 会因为原型链不同
          // 误判结构相同的对象不相等；这里改用 JSON 序列化做纯结构比较。
          // 注意 JSON.stringify 对 key 顺序敏感：语义相同但字段顺序不同的 outputSchema
          // （比如 required 写在 type 前面）会被判不相等——这是刻意从严，强制 21 处字面
          // 一致，不是 bug，遇到误报先检查是不是顺序问题，不要放宽比较逻辑。
          assert.strictEqual(
            JSON.stringify(outputSchema),
            JSON.stringify(EXPECTED_OUTPUT_SCHEMA),
            `${name} 的 outputSchema 形状与共享约定不一致`
          );
        }
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
