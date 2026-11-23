const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepare } = require('../extension/ai-anchors.js');
const colors = ['yellow', 'blue', 'green', 'rose', 'purple'];
test('AI excerpts must exist verbatim after whitespace normalization', () => {
  const text = '团队成员多样性有助于产生不同的想法。心理安全感有利于知识分享。';
  const result = prepare(text, [{ quote: '心理安全感有利于知识分享。', label: '团队因素', note: '原文将心理安全感与知识分享联系起来。', color: 'blue' }], colors);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].anchor.start, text.indexOf('心理')); assert.equal(result.items[0].label, '团队因素');
  assert.equal(prepare(text, [{ quote: '所有团队都会提升创造力。' }], colors).rejected.length, 1);
});
test('duplicate phrases need matching context or an exact start offset', () => {
  const text = '个人因素：动机影响创意。团队因素：动机影响创意。';
  assert.equal(prepare(text, [{ quote: '动机影响创意。' }], colors).items.length, 0);
  const result = prepare(text, [{ quote: '动机影响创意。', prefix: '团队因素：' }], colors);
  assert.equal(result.items[0].anchor.exactCount, 2); assert.equal(result.items[0].anchor.start, text.lastIndexOf('动机'));
  assert.equal(prepare(text, [{ quote: '动机影响创意。', start: text.indexOf('动机') }], colors).items.length, 1);
});
test('rejects invented, oversized, invalid-color or malformed annotations individually', () => {
  const result = prepare('A clear original finding.', [{ quote: 'invented' }, { quote: 'A clear original finding.', color: 'orange' }, { quote: 'A clear original finding.', label: 'x'.repeat(201) }, { quote: 'A clear original finding.', prefix: 9 }, { quote: 'A clear original finding.' }], colors);
  assert.equal(result.items.length, 1); assert.equal(result.rejected.length, 4); assert.equal(result.items[0].index, 4);
});
test('batch size is bounded and a valid anchor keeps surrounding context', () => {
  assert.throws(() => prepare('text', [], colors)); assert.throws(() => prepare('text', Array(201).fill({ quote: 'text' }), colors));
  const item = prepare('Before. The exact sentence. After.', [{ quote: 'The exact sentence.' }], colors).items[0];
  assert.equal(item.anchor.prefix, 'Before. '); assert.equal(item.anchor.suffix, ' After.');
});
