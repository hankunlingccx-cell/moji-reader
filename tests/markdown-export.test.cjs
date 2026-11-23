const { test } = require('node:test');
const assert = require('node:assert/strict');
const Markdown = require('../extension/markdown-export.js');
const Palette = require('../extension/palette.js');
function record(id, overrides = {}) {
  return { id, pageKey: 'https://example.org/paper?version=2', title: '论文一', anchor: { exact: '原文摘录：实验结果与 🧪 观察。', start: 20, end: 40 }, color: 'green', label: '方法、可借鉴', note: '我的理解：需要独立重复。', deleted: false, createdAt: 1, updatedAt: 1, ...overrides };
}
const build = (records, options = {}) => Markdown.build({ records, palette: Palette.defaults(), ids: records.map(r => r.id), exportedAt: '2026-11-23T01:02:03.000Z', ...options });
test('bilingual export distinguishes exact excerpts from aligned paragraphs', () => {
  const r = record('bilingual', { bilingual: { version: 1, variants: [{ language: 'en', scope: 'paragraph', anchor: { exact: 'The original English paragraph is preserved as context.' } }, { language: 'zh', scope: 'selection', anchor: { exact: '手动绑定的精确中文摘录。' } }] } });
  const { markdown } = build([r]);
  assert.ok(markdown.includes('英文原文（对应段落，非逐词对齐）')); assert.ok(markdown.includes('The original English paragraph'));
  assert.ok(markdown.includes('中文译文（精确摘录）')); assert.ok(markdown.includes(r.note));
});
test('exports source links, exact excerpts, current color meaning, tags and user comments', () => {
  const palette = Palette.defaults(); palette.colors.green = { name: '关键证据', hex: '#ff9f43' };
  const { markdown, articleCount, annotationCount } = build([record('id-one')], { palette });
  assert.equal(articleCount, 1); assert.equal(annotationCount, 1);
  for (const value of ['https://example.org/paper?version=2', '原文摘录：实验结果与 🧪 观察。', '关键证据', '#ff9f43', '方法、可借鉴', '我的理解：需要独立重复。', 'id-one']) assert.ok(markdown.includes(value));
});
test('unchecked and deleted records are excluded instead of leaking into a full backup', () => {
  const records = [record('selected'), record('unchecked', { note: 'NOT_SELECTED' }), record('deleted', { deleted: true, note: 'DELETED_NOTE' })];
  const { markdown, annotationCount } = build(records, { ids: ['selected', 'deleted'] });
  assert.equal(annotationCount, 1); assert.ok(!markdown.includes('NOT_SELECTED')); assert.ok(!markdown.includes('DELETED_NOTE'));
});
test('groups by source URL and orders annotations by their position in the original article', () => {
  const records = [record('later', { anchor: { exact: 'LATER_QUOTE', start: 100 }, updatedAt: 20 }), record('earlier', { anchor: { exact: 'EARLIER_QUOTE', start: 10 } }), record('other', { pageKey: 'https://example.org/other', title: '论文二' })];
  const result = build(records); assert.equal(result.articleCount, 2); assert.equal(result.annotationCount, 3);
  assert.ok(result.markdown.indexOf('EARLIER_QUOTE') < result.markdown.indexOf('LATER_QUOTE'));
  assert.equal((result.markdown.match(/原文链接：/g) || []).length, 2);
});
test('preserves multiline code, headings, blank lines and Markdown-like notes verbatim', () => {
  const quote = '第一行\n\n## 原文中的标题\n```js\nconst x = 1;\n```';
  const note = '```text\n我的批注\n```\n\n末行';
  const result = build([record('code', { anchor: { exact: quote, start: 0 }, note })]);
  assert.ok(result.markdown.includes(quote)); assert.ok(result.markdown.includes(note)); assert.ok(result.markdown.includes('````text'));
});
test('labels empty notes and tags explicitly, and preserves an original excerpt after relinking', () => {
  const result = build([record('relinked', { label: '', note: '', originalQuote: '最初选择的句子' })]);
  assert.ok(result.markdown.includes('我的标签：无标签')); assert.ok(result.markdown.includes('无批注')); assert.ok(result.markdown.includes('最初选择的句子'));
});
test('user task can be included or omitted without changing saved data', () => {
  const records = [record('unchanged')], before = structuredClone(records);
  assert.ok(build(records, { task: '请比较方法。' }).markdown.includes('请比较方法。'));
  assert.ok(!build(records, { task: ' ' }).markdown.includes('## 给 AI 的任务'));
  assert.deepEqual(records, before);
});
test('punctuation in titles and URLs cannot break article headings or source links', () => {
  const url = 'https://example.org/paper(a)?q=x&v=2';
  const result = build([record('safe', { title: '论文 [测试]\n# another heading', pageKey: url })]);
  assert.ok(result.markdown.includes('(<https://example.org/paper(a)?q=x&v=2>)')); assert.ok(!result.markdown.includes('\n# another heading'));
});
test('empty selections cannot produce a misleading downloadable document', () => {
  assert.throws(() => build([record('one')], { ids: [] }), /至少勾选/);
});
