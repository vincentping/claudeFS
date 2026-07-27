// scripts/tests/helpers/mini-test.js
// 极简测试跑道，和 edit-file.test.js 里手写的那套一致，抽出来给今天新增的测试文件复用，
// 避免每个文件都重复一遍同样的 pass/fail 记账逻辑。用法：
//   const { runTests } = require('./helpers/mini-test');
//   runTests([['用例名', async () => {...}], ...]);
async function runTests(tests) {
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

module.exports = { runTests };
