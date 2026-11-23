const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const A = require('../extension/anchor.js');
const Article = require('../extension/article.js');
async function setup(t) {
  const [{ Client }, { InMemoryTransport }, { createMcpServer }] = await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'), import('@modelcontextprotocol/sdk/inMemory.js'), import('../bridge/mcp-server.mjs')]);
  const text = 'Team psychological safety promotes creative ideas. Time pressure can reduce exploration.';
  const index = A.buildIndex(new JSDOM(`<nav>${'Menu '.repeat(1000)}</nav><main><h2>Results</h2><p>${text}</p><h2>Discussion</h2><p>Different mechanisms should be considered when interpreting these findings.</p><h2>References</h2><p>Author 2020</p></main>`).window.document);
  const document = { tabId: 7, url: 'https://example.org/paper', title: 'Paper', sourceHash: 'a'.repeat(64), text: index.text, structure: Article.extract(index), colors: { yellow: { name: '结论', hex: '#ffd43b' } } }, calls = [];
  const bridge = { ensure: async () => ({ connected: true }), request: async (method, args) => {
    calls.push({ method, args });
    if (method === 'article.list') return [{ tabId: 7, url: document.url }];
    if (method === 'article.read') return document;
    if (method === 'batch.apply') return { id: 'test-batch', createdCount: args.passages.length, skipped: [], rejected: args.preRejected || [], ...(args.dryRun ? { matchedCount: args.passages.length } : {}) };
    throw Error('unexpected method');
  } };
  const server = createMcpServer(bridge), client = new Client({ name: 'test', version: '1' }), [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b); t.after(async () => { await client.close(); await server.close(); });
  const tool = async (name, args = {}, allowError = false) => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) { if (allowError) return { error: result.content[0].text }; throw Error(result.content[0].text); }
    return JSON.parse(result.content[0].text);
  };
  return { client, tool, calls, document };
}
test('MCP defaults contain the short-request workflow and outline never exposes noisy full text', async t => {
  const { client, tool } = await setup(t), instructions = client.getInstructions();
  assert.ok(instructions.includes('用户只需给主题')); assert.ok(instructions.includes('读完全部默认正文章节'));
  const outline = await tool('moji_article_outline', { url: 'https://example.org/paper#results' });
  assert.equal(outline.text, undefined); assert.equal(outline.sections.length, 3); assert.ok(outline.removedChars > 4000);
  assert.ok(!JSON.stringify(outline).includes('Team psychological safety'));
  const page = await tool('moji_read_article', { articleId: outline.articleId });
  assert.equal(page.paragraphs.length, 2); assert.equal(page.paragraphs[0].sentences.length, 2);
  assert.ok(!JSON.stringify(page).includes('Author 2020'));
});
test('numbered submission resolves exact sentence locally and only sends target coordinates, not the cached full document', async t => {
  const { tool, calls } = await setup(t), outline = await tool('moji_article_outline');
  const page = await tool('moji_read_article', { articleId: outline.articleId, sectionIds: [outline.sections[0].id] });
  const result = await tool('moji_highlight_passages', { articleId: outline.articleId, selections: [{ paragraphId: page.paragraphs[0].id, sentenceNumbers: [2], note: '时间压力限制探索。' }] });
  assert.equal(result.batchId, 'test-batch'); assert.equal(result.createdCount, 1);
  const call = calls.find(c => c.method === 'batch.apply');
  assert.equal(call.args.passages[0].quote, 'Time pressure can reduce exploration.'); assert.equal(call.args.document, undefined);
  assert.equal(call.args.readIds, undefined); assert.deepEqual(call.args.selectionIndices, [0]);
});
test('unread and nonexistent paragraph IDs reject individually without writing and preserve original input indexes', async t => {
  const { tool, calls } = await setup(t), outline = await tool('moji_article_outline');
  const page = await tool('moji_read_article', { articleId: outline.articleId, sectionIds: [outline.sections[0].id] });
  const result = await tool('moji_highlight_passages', { articleId: outline.articleId, selections: [{ paragraphId: 'p2' }, { paragraphId: page.paragraphs[0].id, sentenceNumbers: [1] }, { paragraphId: 'p999' }] });
  assert.equal(result.createdCount, 1); assert.equal(result.rejectedCount, 2);
  assert.deepEqual(calls.find(c => c.method === 'batch.apply').args.selectionIndices, [1]);
  const before = calls.length;
  const invalid = await tool('moji_highlight_passages', { articleId: outline.articleId, selections: [{ paragraphId: 'p999' }] });
  assert.equal(invalid.batchId, null); assert.equal(calls.length, before);
});
test('snapshot handles do not cross-read another article, and raw/numbered submission cannot mix', async t => {
  const { tool } = await setup(t);
  assert.ok((await tool('moji_read_article', { articleId: 'unknown' }, true)).error);
  const outline = await tool('moji_article_outline');
  const mixed = await tool('moji_highlight_passages', { articleId: outline.articleId, selections: [{ paragraphId: 'p1' }], passages: [{ quote: 'anything' }] }, true);
  assert.ok(mixed.error.includes('一种'));
  assert.ok((await tool('moji_article_outline', { url: 'https://example.org/other' }, true)).error.includes('先在 Chrome 打开'));
});
test('chapter reads reuse one local snapshot instead of fetching and exposing the whole article on every page', async t => {
  const { tool, calls } = await setup(t), outline = await tool('moji_article_outline');
  await tool('moji_read_article', { articleId: outline.articleId, sectionIds: [outline.sections[0].id] });
  await tool('moji_read_article', { articleId: outline.articleId, sectionIds: [outline.sections[1].id] });
  assert.equal(calls.filter(c => c.method === 'article.read').length, 1);
});
