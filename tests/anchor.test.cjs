const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const A = require('../extension/anchor.js');
const doc = body => new JSDOM('<body>' + body + '</body>', { url: 'https://example.org/paper' }).window.document;
const index = body => A.buildIndex(doc(body));
function anchorAt(i, quote, nth = 0) {
  let start = -1; do { start = i.text.indexOf(quote, start + 1); } while (nth-- > 0);
  assert.ok(start >= 0); return A.capture(i, A.rangeAt(i, start, start + quote.length));
}
test('normalizes whitespace, soft hyphens and ligatures while preserving inline ranges', () => {
  const d = doc('<p>The <em>eﬀect</em>  of co\u00adoperation is <b>strong</b>.</p><script>ignore me</script><div hidden>secret</div>');
  const i = A.buildIndex(d); assert.equal(i.text, 'The effect of cooperation is strong.');
  const a = anchorAt(i, 'effect of cooperation'); assert.equal(a.exact, 'effect of cooperation');
  assert.equal(A.normalize(A.rangeAt(i, a.start, a.end).toString()), a.exact);
});
test('ranges across paragraph boundaries get a searchable space', () => {
  const i = index('<p>Alpha and beta.</p><p>Gamma delta.</p>');
  assert.equal(i.text, 'Alpha and beta. Gamma delta.');
  assert.equal(anchorAt(i, 'beta. Gamma').exact, 'beta. Gamma');
});
test('exact anchor survives inserted banners and reordered markup', () => {
  const before = index('<article><p>A prefix for the paragraph.</p><p>The experiment produced reproducible positive results.</p><p>Discussion follows.</p></article>');
  const a = anchorAt(before, 'experiment produced reproducible positive results');
  const after = index('<div>New advertisement</div><section><p>A prefix for the paragraph.</p><div>The <em>experiment produced</em> reproducible positive results.</div><p>Discussion follows.</p></section>');
  const found = A.locate(after, a); assert.equal(found.status, 'exact'); assert.equal(after.text.slice(found.start, found.end), a.exact);
});
test('context distinguishes duplicate quotes and position alone is not used', () => {
  const quote = 'We observed a significant increase in the measured response.';
  const before = index(`<p>${'A'.repeat(100)}${quote}${'B'.repeat(100)}</p><p>${'C'.repeat(100)}${quote}${'D'.repeat(100)}</p>`);
  const a = anchorAt(before, quote, 1); assert.equal(a.exactCount, 2);
  const after = index(`<p>Inserted paragraph.</p><p>${'C'.repeat(100)}${quote}${'D'.repeat(100)}</p><p>${'A'.repeat(100)}${quote}${'B'.repeat(100)}</p>`);
  const found = A.locate(after, a); assert.equal(found.status, 'context'); assert.equal(after.text[found.start - 1], 'C');
});
test('identical contexts stay unanchored instead of guessing by offset', () => {
  const quote = 'An identical statement occurs in two identical paragraphs.';
  const i = index(`<p>${'x'.repeat(90)}${quote}${'y'.repeat(90)}</p><p>${'x'.repeat(90)}${quote}${'y'.repeat(90)}</p>`);
  assert.equal(A.locate(i, anchorAt(i, quote)).status, 'unanchored');
});
test('does not attach to a leftover duplicate when original was removed', () => {
  const quote = 'This is a repeated long quote about the experimental result.';
  const before = index(`<p>${'a'.repeat(90)}${quote}${'b'.repeat(90)}</p><p>${'c'.repeat(90)}${quote}${'d'.repeat(90)}</p>`);
  const a = anchorAt(before, quote, 1);
  const after = index(`<p>${'a'.repeat(90)}${quote}${'b'.repeat(90)}</p>`);
  assert.equal(A.locate(after, a).status, 'unanchored');
});
test('small edit recovers only inside unchanged two-sided context', () => {
  const prefix = 'The following evidence supports our main claim: ';
  const quote = 'The experiment produced reproducible positive results in both cohorts.';
  const suffix = ' This finding was verified by independent replication.';
  const a = anchorAt(index(`<p>${prefix}${quote}${suffix}</p>`), quote);
  const changed = index(`<p>${prefix}${quote.replace('positive', 'positve')}${suffix}</p>`);
  assert.equal(A.locate(changed, a).status, 'adjusted');
  const rewritten = index(`<p>${prefix}A totally different claim that contradicts everything before.${suffix}</p>`);
  assert.equal(A.locate(rewritten, a).status, 'unanchored');
  const noContext = index(`<p>New context ${quote.replace('positive', 'positve')} changed surroundings.</p>`);
  assert.equal(A.locate(noContext, a).status, 'unanchored');
});
test('delayed loading can recover without modifying saved anchor', () => {
  const i = index('<p>Important experimental result that must remain in the notes.</p>');
  const a = anchorAt(i, i.text); const saved = structuredClone(a);
  assert.equal(A.locate(index('<p>Loading…</p>'), a).status, 'unanchored');
  assert.equal(A.locate(i, a).status, 'exact'); assert.deepEqual(a, saved);
});
test('emoji UTF-16 range round trip', () => {
  const i = index('<p>这里有 🧪 实验结果与中文标记。</p>');
  const a = anchorAt(i, '🧪 实验结果'); assert.equal(A.rangeAt(i, a.start, a.end).toString(), a.exact);
});
test('ignores tracking parameters and fragments but preserves scientific query parameters', () => {
  assert.equal(A.pageKey('https://example.org/p?version=2&utm_source=a#results'), 'https://example.org/p?version=2');
  assert.notEqual(A.pageKey('https://example.org/p?version=2'), A.pageKey('https://example.org/p?version=1'));
});
