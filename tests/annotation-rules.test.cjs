const { test } = require('node:test'); const assert = require('node:assert/strict');
const R = require('../extension/annotation-rules.js'), AI = require('../extension/ai-anchors.js');
test('AI annotations require a rationale of at most 80 Unicode characters, without silent truncation', () => {
  assert.ok(R.noteError(' ')); assert.equal(R.noteError('理'.repeat(80)), null); assert.ok(R.noteError('理'.repeat(81)));
  assert.equal(R.noteError('🧪'.repeat(80)), null);
  const result = AI.prepare('心理安全感促进创意。', [{ quote: '心理安全感', note: '' }, { quote: '心理安全感', note: '理'.repeat(81) }, { quote: '心理安全感', note: '原文认为它促进意见表达，因此是团队因素。' }], ['yellow'], { selectionMode: 'phrase' });
  assert.equal(result.items.length, 1); assert.equal(result.rejected.length, 2); assert.equal(result.items[0].index, 2);
});
test('explicit noun tasks activate phrase enforcement while sentence tasks retain their scope', () => {
  assert.equal(R.mode('只标影响团队创意的因素名词，不要整段'), 'phrase');
  assert.equal(R.mode('只标因素名称'), 'phrase'); assert.equal(R.mode('不要只标名词，请标注完整句子'), 'sentence');
  assert.equal(R.firstOnly('每个因素只标第一次出现的位置'), true); assert.equal(R.firstOnly('第一次帮我分析研究方法'), false);
});
test('phrases cannot silently expand into full sentences or match inside another English word', () => {
  assert.ok(R.phraseError('心理安全感鼓励团队成员分享新想法。')); assert.equal(R.phraseError('心理安全感'), null);
  assert.deepEqual(R.occurrences('AIM AI-driven AI', 'AI'), [4, 14]);
});
