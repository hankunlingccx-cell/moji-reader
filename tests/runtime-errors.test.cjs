const { test } = require('node:test'); const assert = require('node:assert/strict'); const { describe } = require('../extension/runtime-errors.js');
test('extension update error explains refresh and preserving unsaved inputs without claiming they were saved', () => {
  const value = describe(new Error('Extension context invalidated.'));
  assert.equal(value.invalidated, true); assert.ok(value.message.includes('未保存输入')); assert.ok(value.message.includes('刷新此页')); assert.ok(!value.message.includes('invalidated'));
});
test('temporary worker disconnect remains retryable and ordinary errors keep their meaning', () => {
  assert.equal(describe(new Error('Could not establish connection. Receiving end does not exist.')).invalidated, false);
  assert.equal(describe(new Error('disk full')).message, 'disk full');
});
