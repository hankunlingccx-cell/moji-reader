import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startBroker } from '../bridge/broker.mjs';
import { extensionId } from '../bridge/config.mjs';
import Anchor from '../extension/anchor.js';

const factor1 = '团队成员的知识多样性能够提供不同视角，帮助形成新颖的创意。';
const factor2 = '心理安全感让成员更愿意提出不同意见并分享尚不成熟的想法。';
const factor3 = '时间压力过高会减少探索和试验，从而限制团队的创意产出。';
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>团队创意产出的影响因素 · 连接测试</title><style>body{font:17px/1.9 system-ui;background:#fff;color:#242428;max-width:760px;margin:70px 9%}h1{font-size:32px;line-height:1.5}p{margin:24px 0}.muted{color:#999;font-size:12px}</style></head><body><p class="muted">墨迹 × Codex · 虚构测试文章</p><h1>团队创意产出的影响因素</h1><h2>研究发现</h2><p id="factor1">${factor1}</p><p id="factor2">${factor2}</p><p id="factor3">${factor3}</p><h2>阅读材料</h2><p>${'这是用于测试分页读取的背景说明，不构成额外研究证据。'.repeat(65)}</p></body></html>`;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moji-bridge-test-'));
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const manifest = JSON.parse(await fs.readFile('extension/manifest.json', 'utf8'));
const config = { app: 'moji-codex-bridge', version: 1, host: '127.0.0.1', port, token: crypto.randomBytes(32).toString('hex'), extensionId: extensionId(manifest.key) };
const configPath = path.join(temp, 'connection.json'); await fs.writeFile(configPath, JSON.stringify(config));
const broker = await startBroker(config);
const site = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }); site.listen(0, '127.0.0.1'); await once(site, 'listening');
const articleUrl = `http://127.0.0.1:${site.address().port}/paper`;
let context, mcp;
const failures = [];
try {
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: 'Bearer ' + config.token, Origin: 'https://example.org' } })).status, 403);
  const wrong = new WebSocket(`ws://127.0.0.1:${port}/extension`, { headers: { Origin: `chrome-extension://${config.extensionId}` } });
  wrong.on('error', () => {}); await once(wrong, 'open'); wrong.send(JSON.stringify({ type: 'hello', token: '0'.repeat(64) })); assert.equal((await once(wrong, 'close'))[0], 1008);
  console.log('PASS: loopback broker rejects missing authentication, browser-origin HTTP and invalid WebSocket tokens');
  mcp = new Client({ name: 'moji-integration-test', version: '1.0' });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('bridge/mcp-server.mjs'), '--config', configPath], stderr: 'pipe' }));
  assert.equal((await mcp.listTools()).tools.length, 7);
  async function tool(name, args = {}, allowError = false) {
    const result = await mcp.callTool({ name, arguments: args });
    if (result.isError) { if (allowError) return { error: result.content[0].text }; throw new Error(result.content[0].text); }
    return JSON.parse(result.content.find(c => c.type === 'text').text);
  }
  assert.equal((await tool('moji_connection_status')).connected, false);
  console.log('PASS: actual MCP stdio handshake and seven tool definitions work before pairing');
  const extension = path.resolve('extension'), profile = path.join(temp, 'profile');
  const launch = () => chromium.launchPersistentContext(profile, { channel: process.env.MOJI_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'), headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  context = await launch(); const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(new URL(worker.url()).host, config.extensionId);
  let library = await context.newPage(); library.on('pageerror', e => failures.push(e.message));
  await library.goto(`chrome-extension://${config.extensionId}/library.html#codex`);
  library.setDefaultTimeout(15000);
  await library.locator('#codex-connection-file').setInputFiles(configPath);
  await library.locator('#codex-status.connected').waitFor();
  assert.equal((await tool('moji_connection_status')).connected, true);
  console.log('PASS: real extension imports a connection file and authenticates to the local broker');
  let paper = await context.newPage(); paper.on('pageerror', e => failures.push(e.message)); await paper.goto(articleUrl); await paper.locator('#launcher').waitFor(); await paper.bringToFront();
  const list = await tool('moji_list_articles'), target = list.find(item => item.url === articleUrl); assert.ok(target);
  let document = await tool('moji_read_article', { tabId: target.tabId, maxChars: 1000 }); assert.ok(document.nextOffset);
  let combined = document.text, next = document.nextOffset;
  while (next !== null) { const part = await tool('moji_read_article', { articleId: document.articleId, offset: next, maxChars: 1000 }); combined += part.text; next = part.nextOffset; }
  for (const text of [factor1, factor2, factor3]) assert.ok(combined.includes(Anchor.normalize(text)));
  console.log('PASS: Codex tools read the selected article and paginate through all its normalized text');
  const rpc = async (type, fields = {}) => library.evaluate(async ({ type, fields }) => { const result = await chrome.runtime.sendMessage({ type: 'moji:' + type, ...fields }); if (!result.ok) throw new Error(result.error); return result.value; }, { type, fields });
  const manualQuote = Anchor.normalize(factor1), start = combined.indexOf(manualQuote), manualId = crypto.randomUUID();
  await rpc('mutate', { id: manualId, baseRevision: 0, opId: crypto.randomUUID(), patch: { title: document.title, pageKey: articleUrl, anchor: { exact: manualQuote, prefix: combined.slice(Math.max(0, start - 80), start), suffix: combined.slice(start + manualQuote.length, start + manualQuote.length + 80), start, end: start + manualQuote.length, version: 1, exactCount: 1 }, originalQuote: manualQuote, label: '我的手动标签', note: '原来的手动笔记不得覆盖', color: 'yellow', styles: { highlight: true, underline: false, bold: false }, deleted: false } });
  const passages = [
    { quote: factor1, color: 'blue', label: '团队构成', note: '直接证据：知识多样性提供不同视角。' },
    { quote: factor2, color: 'green', label: '团队互动', note: '直接证据：心理安全感促进意见表达和想法分享。' },
    { quote: factor3, color: 'rose', label: '时间与资源', note: '直接证据：过高时间压力限制探索与试验，作用方向为负面。' },
    { quote: '这是文章里不存在的虚构结论。', color: 'purple', label: '不得创建', note: '不存在的原文必须被拒绝。' }
  ];
  await paper.locator('#factor2').evaluate(e => { e.textContent += '正文更新。'; });
  const stale = await tool('moji_highlight_passages', { articleId: document.articleId, batchLabel: '版本检查', passages }, true); assert.match(stale.error, /正文已变化/);
  assert.equal((await rpc('list')).records.length, 1);
  await paper.locator('#factor2').evaluate((e, value) => { e.textContent = value; }, factor2);
  document = await tool('moji_read_article', { tabId: target.tabId });
  const preview = await tool('moji_highlight_passages', { articleId: document.articleId, batchLabel: '团队创意影响因素', task: '将所有影响团队创意产出的因素高亮', passages, dryRun: true });
  assert.equal(preview.matchedCount, 3); assert.equal(preview.rejected.length, 1); assert.equal((await rpc('list')).records.length, 1);
  console.log('PASS: stale document versions are rejected and dry-run matching does not modify notes');
  const batch = await tool('moji_highlight_passages', { articleId: document.articleId, batchLabel: '团队创意影响因素', task: '将所有影响团队创意产出的因素高亮', passages });
  assert.equal(batch.createdCount, 3); assert.equal(batch.skipped.length, 0); assert.equal(batch.rejected.length, 1);
  await paper.waitForFunction(() => document.querySelectorAll('[data-moji-mark]').length >= 3);
  let data = await rpc('list'); const ai = data.records.filter(r => r.aiBatchId === batch.id);
  assert.equal(ai.length, 3); assert.ok(ai.every(r => r.styles.underline && !r.styles.highlight)); assert.equal(ai.find(r => r.color === 'green').label, '团队互动'); assert.match(ai.find(r => r.color === 'rose').note, /负面/);
  assert.equal(data.records.find(r => r.id === manualId).note, '原来的手动笔记不得覆盖');
  const duplicate = await tool('moji_highlight_passages', { articleId: document.articleId, batchLabel: '重复检测', passages }); assert.equal(duplicate.createdCount, 0); assert.equal(duplicate.skipped.length, 3);
  console.log('PASS: MCP creates correctly anchored highlights with labels and comments; duplicates and nonexistent text are reported');
  const edited = ai[0]; await rpc('mutate', { id: edited.id, baseRevision: edited.revision, opId: crypto.randomUUID(), patch: { note: '用户在自动高亮后补充的笔记' } });
  await paper.locator('#launcher').click(); await fs.mkdir('artifacts', { recursive: true }); await paper.screenshot({ path: 'artifacts/codex-highlights.png', fullPage: true });
  await library.bringToFront(); await library.locator(`button[data-batch-id="${batch.id}"]`).waitFor(); await library.screenshot({ path: 'artifacts/codex-connection.png', fullPage: true });
  assert.equal((await tool('moji_list_batches')).find(b => b.id === batch.id).activeCount, 3);
  assert.equal((await tool('moji_undo_batch', { batchId: batch.id })).undoneCount, 3);
  data = await rpc('list'); assert.equal(data.records.filter(r => !r.deleted).length, 1); assert.equal(data.records.find(r => r.id === edited.id).note, '用户在自动高亮后补充的笔记');
  assert.equal((await tool('moji_undo_batch', { batchId: batch.id })).undoneCount, 0);
  console.log('PASS: whole-batch MCP undo preserves edited notes in trash and leaves manual highlights untouched');
  await context.close(); context = await launch(); library = await context.newPage(); await library.goto(`chrome-extension://${config.extensionId}/library.html#codex`); await library.locator('#codex-status.connected').waitFor();
  assert.equal((await tool('moji_list_batches')).find(b => b.id === batch.id).activeCount, 0);
  paper = await context.newPage(); await paper.goto(articleUrl); await paper.locator('#launcher').waitFor(); await paper.bringToFront(); document = await tool('moji_read_article');
  const uiBatch = await tool('moji_highlight_passages', { articleId: document.articleId, batchLabel: '界面整批撤销测试', passages: [passages[1]] }); assert.equal(uiBatch.createdCount, 1);
  await library.bringToFront(); await library.locator(`button[data-batch-id="${uiBatch.id}"]`).click(); await library.locator('#codex-operation-status').filter({ hasText: '已撤销 1 条' }).waitFor();
  assert.equal((await tool('moji_list_batches')).find(b => b.id === uiBatch.id).activeCount, 0);
  await library.locator('#codex-disconnect').click(); await library.locator('#codex-status').filter({ hasText: '已断开' }).waitFor();
  assert.equal((await tool('moji_connection_status')).connected, false);
  await library.locator('#codex-reconnect').click(); await library.locator('#codex-status.connected').waitFor();
  assert.deepEqual(failures, []);
  console.log('PASS: browser restart reconnects, batches survive restart, UI undo and explicit disconnect/reconnect work');
  const outline = await tool('moji_article_outline', { url: articleUrl });
  assert.equal(outline.text, undefined);
  const findings = outline.sections.find(s => s.title === '研究发现'); assert.ok(findings);
  const numbered = await tool('moji_read_article', { articleId: outline.articleId, sectionIds: [findings.id] });
  assert.equal(numbered.paragraphs.length, 3); assert.equal(numbered.nextParagraphOffset, null);
  const id2 = numbered.paragraphs[1].id, id3 = numbered.paragraphs[2].id;
  const selections = [{ paragraphId: id2, sentenceNumbers: [1], color: 'green', label: '团队互动', note: '直接证据：心理安全感促进分享。' }, { paragraphId: 'p999' }, { paragraphId: id3, sentenceNumbers: [1], color: 'rose', label: '任务条件', note: '直接证据：过高时间压力限制探索。' }];
  const numberedBatch = await tool('moji_highlight_passages', { articleId: outline.articleId, selections, batchLabel: '编号标注' });
  assert.equal(numberedBatch.createdCount, 2); assert.equal(numberedBatch.rejectedCount, 1); assert.equal(numberedBatch.rejected[0].index, 1);
  const numberedData = (await rpc('list')).records.filter(r => r.aiBatchId === numberedBatch.batchId);
  assert.equal(numberedData.length, 2); assert.equal(numberedData.find(r => r.color === 'green').anchor.exact, Anchor.normalize(factor2));
  assert.equal((await tool('moji_undo_batch', { batchId: numberedBatch.batchId })).undoneCount, 2);
  assert.equal((await rpc('list')).records.find(r => r.id === manualId).deleted, false);
  await paper.locator('#factor2').evaluate(e => { e.textContent += '正文再次更新。'; });
  const staleNumbered = await tool('moji_highlight_passages', { articleId: outline.articleId, selections: [selections[0]] }, true);
  assert.match(staleNumbered.error, /正文已变化/);
  console.log('PASS: chapter outline, numbered sentence writes, original rejection indexes and stale-snapshot refusal work through real MCP; whole-batch undo preserves manual notes');
  const english = 'Psychological safety enables team members to share unfamiliar ideas and express disagreements.';
  await paper.locator('#factor2').evaluate((el, value) => { el.textContent = value; }, english);
  await tool('moji_article_outline', { url: articleUrl }); // Capture the actual pre-translation source.
  await paper.locator('#factor2').evaluate((el, value) => { document.documentElement.classList.add('translated-ltr'); el.innerHTML = `<font>${value}</font>`; }, factor2);
  const dualOutline = await tool('moji_article_outline', { url: articleUrl });
  const dualPage = await tool('moji_read_article', { articleId: dualOutline.articleId, sectionIds: [dualOutline.sections.find(s => s.title === '研究发现').id] });
  const dualParagraph = dualPage.paragraphs.find(p => p.sentences[0] === Anchor.normalize(factor2)); assert.ok(dualParagraph);
  const dualBatch = await tool('moji_highlight_passages', { articleId: dualOutline.articleId, selections: [{ paragraphId: dualParagraph.id, sentenceNumbers: [1], label: '团队互动', note: '直接证据：心理安全感促进表达。', color: 'green' }] });
  assert.equal(dualBatch.createdCount, 1);
  const dualRecord = (await rpc('list')).records.find(r => r.aiBatchId === dualBatch.batchId);
  assert.ok(dualRecord.bilingual.variants.some(v => v.language === 'en' && v.anchor.exact === english));
  await paper.locator('#factor2').evaluate((el, value) => { document.documentElement.classList.remove('translated-ltr'); el.textContent = value; }, english);
  await paper.locator(`[data-moji-mark~="${dualRecord.id}"]`).first().waitFor();
  assert.ok((await paper.locator(`[data-moji-mark~="${dualRecord.id}"]`).allTextContents()).join('').includes(english));
  assert.equal((await tool('moji_undo_batch', { batchId: dualBatch.batchId })).undoneCount, 1);
  const retainedDual = (await rpc('list')).records.find(r => r.id === dualRecord.id);
  assert.equal(retainedDual.note, '直接证据：心理安全感促进表达。'); assert.equal(retainedDual.deleted, true);
  assert.ok(retainedDual.bilingual.variants.some(v => v.language === 'en'));
  console.log('PASS: numbered Chinese annotations preserve actual English counterparts, restore on language switch, and retain bilingual notes after whole-batch undo');
  console.log('All local MCP ↔ broker ↔ real extension scenarios passed. No personal browser profile was used.');
} finally {
  if (context) await context.close(); if (mcp) await mcp.close(); await broker.close(); await new Promise(resolve => site.close(resolve));
}
