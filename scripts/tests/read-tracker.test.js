// scripts/tests/read-tracker.test.js
// node scripts/tests/read-tracker.test.js
const assert = require('assert');
const { loadContext } = require('./helpers/load-context');
const { runTests } = require('./helpers/mini-test');

const CORE_FILES = ['core/fs/name-escape.js', 'core/fs/sandbox.js', 'core/fs/read-tracker.js'];

function setup() {
  const root = loadContext(CORE_FILES);
  return root.ClaudefsCore.fs.readTracker;
}

async function main() {
  await runTests([
    [
      '无基线：从未 recordRead 过的路径，checkConflict 返回 null（不警示）',
      async () => {
        const tracker = setup();
        assert.strictEqual(tracker.checkConflict('a.txt', 12345), null);
      }
    ],
    [
      '读后未变：mtime 与基线相同，不警示',
      async () => {
        const tracker = setup();
        tracker.recordRead('a.txt', 1000);
        assert.strictEqual(tracker.checkConflict('a.txt', 1000), null);
      }
    ],
    [
      '读后外部修改：当前 mtime 晚于基线，返回警示文字',
      async () => {
        const tracker = setup();
        tracker.recordRead('a.txt', 1000);
        const warning = tracker.checkConflict('a.txt', 2000);
        assert.ok(warning && warning.includes('modified externally'), warning);
      }
    ],
    [
      '自己的写不误报：recordWrite 更新基线后，同 mtime 检查不再警示',
      async () => {
        const tracker = setup();
        tracker.recordRead('a.txt', 1000);
        tracker.recordWrite('a.txt', 2000);
        assert.strictEqual(tracker.checkConflict('a.txt', 2000), null);
      }
    ],
    [
      '不同写法的路径落到同一个 tracker key（分隔符归一化）',
      async () => {
        const tracker = setup();
        tracker.recordRead('a/b.txt', 1000);
        const warning = tracker.checkConflict('a\\b.txt', 2000);
        assert.ok(warning, '应该命中同一个 key 并检测到冲突');
      }
    ],
    [
      'reset() 清空全部基线',
      async () => {
        const tracker = setup();
        tracker.recordRead('a.txt', 1000);
        tracker.reset();
        assert.strictEqual(tracker.checkConflict('a.txt', 2000), null);
      }
    ],
    [
      '当前 mtime 早于基线（不太可能出现，但不应误报）：不警示',
      async () => {
        const tracker = setup();
        tracker.recordRead('a.txt', 2000);
        assert.strictEqual(tracker.checkConflict('a.txt', 1000), null);
      }
    ]
  ]);
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
