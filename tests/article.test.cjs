const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const A = require('../extension/anchor.js');
const Article = require('../extension/article.js');
const extract = body => Article.extract(A.buildIndex(new JSDOM(`<body>${body}</body>`).window.document));
const sentence = 'Psychological safety helps team members express unusual ideas and improves collective creativity.';
test('noun mode requires a real short phrase, resolves only its exact characters, and rejects ambiguous/late occurrences', () => {
  const structure = extract('<main><h2>Results</h2><p>心理安全感促进分享。心理安全感还支持探索。</p><p>心理安全感促进团队创意。</p></main>');
  const options = { selectionMode: 'phrase', firstOnly: true, requireNote: true }, note = '文中认为它促进分享和探索，因此属于促进因素。';
  const result = Article.resolve(structure, [{ paragraphId: 'p1', sentenceNumbers: [1], note }, { paragraphId: 'p1', phrase: '心理安全感', note }, { paragraphId: 'p1', phrase: '心理安全感', occurrence: 2, note }, { paragraphId: 'p2', phrase: '心理安全感', note }, { paragraphId: 'p1', phrase: '心理安全感', occurrence: 1, note }], options);
  assert.equal(result.passages.length, 1); assert.equal(result.rejected.length, 4); assert.equal(result.passages[0].quote, '心理安全感'); assert.equal(result.passages[0].selectionMode, 'phrase');
});
const fixture = () => extract(`<header>Journal subscriptions</header><nav>Huge navigation menu ${'noise '.repeat(1000)}</nav><main><h1>Team creativity</h1><h2>Introduction</h2><p>We examine factors that affect team creativity in organizations and explain their mechanisms.</p><div class="cookie-banner">Please accept cookies</div><h2>Results</h2><p>${sentence} Resource constraints can limit exploration.</p><p>知识多样性提供不同视角。心理安全感促进成员分享新想法。</p><h2>References</h2><p>Author et al. 2020. Bibliographic information.</p><h3>Further citations</h3><p>Other author. 2024.</p><h2>Appendix</h2><p>Supplementary evidence should remain available.</p></main><footer>Copyright policy</footer>`);
test('semantic extraction removes navigation and consent while retaining body, headings and explicit reference sections', () => {
  const structure = fixture(), text = structure.paragraphs.map(p => p.text).join('\n');
  assert.equal(structure.extraction, 'semantic'); assert.ok(structure.removedChars > 5000);
  for (const noise of ['Huge navigation', 'accept cookies', 'Copyright policy', 'subscriptions']) assert.ok(!text.includes(noise));
  assert.ok(text.includes(sentence)); assert.ok(text.includes('Bibliographic information'));
  const headings = Article.outline(structure); assert.equal(headings.find(s => s.title === 'References').defaultRead, false);
  assert.equal(headings.find(s => s.title === 'Further citations').kind, 'references'); assert.equal(headings.find(s => s.title === 'Appendix').defaultRead, true);
});
test('default structured reading excludes references but explicitly requesting them works', () => {
  const structure = fixture(), page = Article.read(structure);
  assert.ok(!JSON.stringify(page).includes('Bibliographic information'));
  const refs = Article.read(structure, { sectionIds: [structure.sections.find(s => s.title === 'References').id] });
  assert.ok(JSON.stringify(refs).includes('Bibliographic information')); assert.equal(refs.nextParagraphOffset, null);
});
test('paragraph and sentence numbers resolve exact UTF-16 positions, including Chinese, emoji and repeated text', () => {
  const doc = new JSDOM(`<body><article><h2>Findings</h2><p>${sentence}</p><p>${sentence}</p><p>团队成员表达观点。🧪实验结果支持这一结论。另一个句子用于复核。</p></article></body>`).window.document;
  const index = A.buildIndex(doc), structure = Article.extract(index), duplicate = structure.paragraphs[1], chinese = structure.paragraphs[2];
  const result = Article.resolve(structure, [{ paragraphId: duplicate.id }, { paragraphId: chinese.id, sentenceNumbers: [2] }]);
  assert.equal(result.rejected.length, 0); assert.equal(result.passages[0].start, duplicate.start);
  assert.equal(result.passages[1].quote, '🧪实验结果支持这一结论。');
  for (const p of result.passages) assert.equal(index.text.slice(p.start, p.start + p.quote.length), p.quote);
});
test('invalid, noncontiguous or out-of-range sentence IDs reject without silently highlighting another sentence', () => {
  const structure = fixture(), p = structure.paragraphs.find(p => p.sentences.length > 1);
  const result = Article.resolve(structure, [{ paragraphId: 'p999' }, { paragraphId: p.id, sentenceNumbers: [1, 3] }, { paragraphId: p.id, sentenceNumbers: [0] }, { paragraphId: p.id, sentenceNumbers: [1, 1] }]);
  assert.equal(result.passages.length, 0); assert.equal(result.rejected.length, 4);
});
test('bounded paragraph pagination has no missing or repeated paragraphs and validates section/cursor', () => {
  const structure = extract(`<main><h2>Results</h2>${Array.from({ length: 30 }, (_, i) => `<p>${i} ${sentence.repeat(6)}</p>`).join('')}</main>`), seen = [];
  let offset = 0;
  do { const page = Article.read(structure, { offset, maxChars: 1000 }); seen.push(...page.paragraphs.map(p => p.id)); offset = page.nextParagraphOffset; } while (offset !== null);
  assert.deepEqual(seen, structure.paragraphs.map(p => p.id));
  assert.throws(() => Article.read(structure, { sectionIds: ['invalid'] })); assert.throws(() => Article.read(structure, { offset: 999 }));
});
test('fallback retains unstructured body content and excludes global header/footer without guessing semantic relevance', () => {
  const structure = extract(`<header>Navigation page title</header><p>${sentence}</p><p>Do not remove an important negative finding just because it lacks the query keyword.</p><footer>Terms</footer>`);
  assert.equal(structure.extraction, 'fallback'); assert.equal(structure.paragraphs.length, 2);
});
test('very long paragraphs split into bounded chunks while preserving resolvable original positions', () => {
  const text = 'x'.repeat(21000), doc = new JSDOM(`<p>${text}</p>`).window.document, index = A.buildIndex(doc), structure = Article.extract(index);
  assert.equal(structure.paragraphs.length, 4); assert.equal(structure.paragraphs.map(p => p.text).join(''), text);
  for (const p of structure.paragraphs) assert.equal(Article.resolve(structure, [{ paragraphId: p.id }]).passages[0].start, p.start);
});
