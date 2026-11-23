const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const A = require('../extension/anchor.js');
const B = require('../extension/bilingual.js');
const en = 'Psychological safety encourages team members to share unusual ideas and express disagreements.';
const zh = '心理安全感鼓励团队成员分享不同寻常的想法并表达不同意见。';
test('precise AI nouns never expand to a paragraph when switching languages, but manual precise bindings restore them', () => {
  const { tracker, translate } = setup(), chineseIndex = translate(), anchor = capture(chineseIndex, '心理安全感'), bilingual = tracker.capture(chineseIndex, anchor);
  const english = setup(), index = A.buildIndex(english.doc), record = { anchor, bilingual, aiSelectionMode: 'phrase' };
  assert.equal(english.tracker.locate(index, record).status, 'unanchored');
  record.bilingual = B.merge(bilingual, { variants: [{ language: 'en', scope: 'selection', anchor: capture(index, 'Psychological safety') }] });
  const found = english.tracker.locate(index, record); assert.equal(found.scope, 'selection'); assert.equal(index.text.slice(found.start, found.end), 'Psychological safety');
});
function setup(body = `<p id="claim">${en}</p>`) {
  const doc = new JSDOM(`<html lang="en"><body>${body}</body></html>`, { url: 'https://example.org/paper' }).window.document;
  const tracker = B.create(doc); tracker.sync();
  const translate = (value = zh) => { doc.documentElement.classList.add('translated-ltr'); doc.querySelector('#claim').innerHTML = `<font>${value}</font>`; return tracker.sync(); };
  const original = () => { doc.documentElement.classList.remove('translated-ltr'); doc.querySelector('#claim').textContent = en; return tracker.sync(); };
  return { doc, tracker, translate, original };
}
function capture(index, value) { const start = index.text.indexOf(value); return A.capture(index, A.rangeAt(index, start, start + value.length)); }
test('Chinese selections save English paragraph and recover after reload without a live translation map', () => {
  const { tracker, translate } = setup(), index = translate();
  const anchor = capture(index, '分享不同寻常的想法并表达不同意见'), bilingual = tracker.capture(index, anchor);
  assert.ok(bilingual.variants.some(v => v.language === 'en' && v.anchor.exact === en && v.scope === 'paragraph'));
  const reload = setup(), found = reload.tracker.locate(A.buildIndex(reload.doc), { anchor, bilingual });
  assert.equal(found.scope, 'paragraph'); assert.equal(A.buildIndex(reload.doc).text.slice(found.start, found.end), en);
});
test('English partial selection recovers at its actual translated paragraph, explicitly with paragraph scope', () => {
  const { doc, tracker, translate } = setup();
  const anchor = capture(A.buildIndex(doc), 'share unusual ideas and express disagreements');
  const index = translate(), found = tracker.locate(index, { anchor });
  assert.equal(found.status, 'bilingual'); assert.equal(found.scope, 'paragraph');
  assert.equal(index.text.slice(found.start, found.end), A.normalize(zh));
  assert.ok(found.bilingual.variants.some(v => v.language === 'en'));
});
test('a page already translated at injection can establish correspondence when user shows original once', () => {
  const { doc, tracker, original } = setup(`<p id="claim">${zh}</p>`);
  doc.documentElement.classList.add('translated-ltr'); tracker.sync();
  const anchor = capture(A.buildIndex(doc), A.normalize(zh));
  const found = tracker.locate(original(), { anchor });
  assert.equal(found.status, 'bilingual'); assert.equal(found.language, 'en');
});
test('same position and matching structure alone never create a bilingual correspondence', () => {
  const { doc, tracker } = setup(), anchor = capture(A.buildIndex(doc), en);
  doc.querySelector('#claim').textContent = zh;
  assert.equal(tracker.locate(tracker.sync(), { anchor }).status, 'unanchored');
});
test('replaced DOM elements do not inherit a translated association just by ID or paragraph order', () => {
  const { doc, tracker } = setup(), anchor = capture(A.buildIndex(doc), en);
  doc.documentElement.classList.add('translated-ltr'); doc.querySelector('#claim').outerHTML = `<p id="claim">${zh}</p>`;
  assert.equal(tracker.locate(tracker.sync(), { anchor }).status, 'unanchored');
});
test('identical original paragraphs remain ambiguous rather than selecting a translated one by offset', () => {
  const { doc, tracker } = setup(`<p id="claim">${en}</p><p id="other">${en}</p>`), anchor = capture(A.buildIndex(doc), en);
  doc.documentElement.classList.add('translated-ltr'); doc.querySelector('#claim').textContent = zh; doc.querySelector('#other').textContent = '另一段相同英文的中文翻译，但不能确定选择了哪一段。';
  assert.equal(tracker.locate(tracker.sync(), { anchor }).status, 'unanchored');
});
test('ordinary same-language page edits invalidate remembered translation correspondence', () => {
  const { doc, tracker, translate } = setup(), anchor = capture(A.buildIndex(doc), en);
  translate(); doc.querySelector('#claim').textContent = '这是完全不相干的新内容，不能沿用之前的双语对应关系。';
  assert.equal(tracker.locate(tracker.sync(), { anchor }).status, 'unanchored');
});
test('manual precise second-language binding takes precedence over paragraph fallback', () => {
  const { tracker, translate, doc } = setup(), originalAnchor = capture(A.buildIndex(doc), en), index = translate();
  const selected = capture(index, '分享不同寻常的想法并表达不同意见');
  const bilingual = B.merge(tracker.capture(index, selected), { variants: [{ language: 'zh', scope: 'selection', anchor: selected }] });
  const found = tracker.locate(index, { anchor: originalAnchor, bilingual });
  assert.equal(found.scope, 'selection'); assert.equal(index.text.slice(found.start, found.end), selected.exact);
});
test('language variants stay bounded and deduplicate repeat observations', () => {
  const anchor = { exact: en }, value = { variants: [{ language: 'en', scope: 'paragraph', anchor }] };
  assert.equal(B.merge(value, value).variants.length, 1);
});
test('incremental font-wrapped translation retains the complete original instead of a partially translated source', () => {
  const { doc, tracker } = setup(), anchor = capture(A.buildIndex(doc), en);
  doc.documentElement.classList.add('translated-ltr'); doc.querySelector('#claim').innerHTML = '<font>心理安全感 encourages team members to share unusual ideas and express disagreements.</font>'; tracker.sync();
  doc.querySelector('#claim').innerHTML = '<font>心理安全感鼓励团队成员分享想法。</font>'; tracker.sync();
  doc.querySelector('#claim').innerHTML = `<font>${zh}</font>`; const index = tracker.sync();
  const found = tracker.locate(index, { anchor });
  assert.equal(found.status, 'bilingual'); assert.ok(found.bilingual.variants.some(v => v.anchor.exact === en));
});
