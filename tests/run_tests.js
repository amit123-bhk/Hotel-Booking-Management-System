const { run } = require('node:test');
const path = require('node:path');

console.log('===============================================================');
console.log(' Grand Horizon Luxury Hotel & Resort - Automated Test Suite');
console.log('===============================================================');

const testFiles = [
  path.join(__dirname, 'unit.test.js'),
  path.join(__dirname, 'integration.test.js')
];

const testStream = run({
  files: testFiles
});

testStream.on('test:fail', (data) => {
  console.error(`❌ FAIL: ${data.name} (${data.details?.duration_ms?.toFixed(1) || 0}ms)`);
  if (data.details?.error) {
    console.error(data.details.error);
  }
});

testStream.on('test:pass', (data) => {
  console.log(`✅ PASS: ${data.name} (${data.details?.duration_ms?.toFixed(1) || 0}ms)`);
});

testStream.on('test:summary', (summary) => {
  console.log('---------------------------------------------------------------');
  console.log(`Test Execution Summary:`);
  console.log(` Total Tests: ${summary.counts.total}`);
  console.log(` Passed:      ${summary.counts.passed}`);
  console.log(` Failed:      ${summary.counts.failed}`);
  console.log(` Cancelled:   ${summary.counts.cancelled}`);
  console.log(` Skipped:     ${summary.counts.skipped}`);
  console.log('---------------------------------------------------------------');

  if (summary.counts.failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL ACCEPTANCE & BUSINESS INTEGRITY TESTS PASSED!');
    process.exit(0);
  }
});
