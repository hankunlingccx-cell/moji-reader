const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const en = 'Psychological safety encourages team members to share unusual ideas and express disagreements.';
const zh = '心理安全感鼓励团队成员分享不同寻常的想法并表达不同意见。';
const quote = '分享不同寻常的想法并表达不同意见';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bilingual recovery test</title><style>body{margin:90px;max-width:700px;font:20px/2 system-ui}</style></head><body><h1>Team creativity</h1><p id="claim">${en}</p><p id="other">Diverse expertise helps a team explore alternatives and develop more creative solutions.</p></body></html>`;
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'moji-bilingual-'));
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    const extension = path.resolve('extension');
    context = await chromium.launchPersistentContext(profile, { channel: process.env.MOJI_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'), headless: true, viewport: { width: 1440, height: 1000 }, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const library = await context.newPage(); await library.goto(`chrome-extension://${id}/library.html`);
    const rpc = (type, fields = {}) => library.evaluate(async ({ type, fields }) => { const result = await chrome.runtime.sendMessage({ type: 'moji:' + type, ...fields }); if (!result.ok) throw new Error(result.error); return result.value; }, { type, fields });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/paper`); await page.locator('#launcher').waitFor();
    const translate = async () => { await page.locator('#claim').evaluate((el, value) => { document.documentElement.classList.add('translated-ltr'); el.innerHTML = `<font>${value}</font>`; }, zh); };
    const select = async value => {
      await page.locator('#claim').evaluate((el, value) => {
        const nodes = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let all = '';
        while (walker.nextNode()) { const node = walker.currentNode; nodes.push({ node, start: all.length, end: all.length + node.length }); all += node.data; }
        const start = all.indexOf(value); if (start < 0) throw Error('Missing selection'); const end = start + value.length;
        const a = nodes.find(x => x.end > start), b = nodes.find(x => x.end >= end), range = document.createRange();
        range.setStart(a.node, start - a.start); range.setEnd(b.node, end - b.start); getSelection().removeAllRanges(); getSelection().addRange(range);
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
      }, value);
      await page.locator('#toolbar').waitFor({ state: 'visible' });
    };
    await translate(); await select(quote); await page.locator('[data-color-add="green"]').click();
    await page.locator('[data-moji-mark]').first().waitFor();
    let record = (await rpc('list')).records[0]; assert.ok(record.bilingual.variants.some(v => v.language === 'en' && v.anchor.exact === en));
    await rpc('autosave', { id: record.id, draftId: 'bilingual-test-note', baseRevision: record.revision, sequence: 1, label: '团队互动', note: '心理安全感是促进团队创意的因素。' });
    await page.reload(); await page.locator('[data-moji-mark]').first().waitFor();
    assert.equal(await page.locator('#claim').innerText(), en); assert.ok((await page.locator('#claim [data-moji-mark]').allTextContents()).join('').includes(en));
    await page.locator('#launcher').click(); assert.ok((await page.locator('.badge').allTextContents()).includes('跨语言段落定位'));
    console.log('PASS: Chinese selection stores English counterpart; reload on English recovers paragraph and retains Chinese notes');
    await translate(); await page.waitForFunction(value => [...document.querySelectorAll('[data-moji-mark]')].map(n => n.textContent).join('') === value, quote);
    assert.equal((await rpc('list')).records[0].note, '心理安全感是促进团队创意的因素。');
    console.log('PASS: switching back to Chinese restores the precise original selection');
    await page.locator('.actions button').filter({ hasText: '绑定另一语言' }).click();
    await page.locator('#claim').evaluate((el, value) => { document.documentElement.classList.remove('translated-ltr'); el.textContent = value; }, en);
    await select('share unusual ideas and express disagreements'); await page.locator('#relink-selection').click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-moji-mark]')].map(n => n.textContent).join('') === 'share unusual ideas and express disagreements');
    record = (await rpc('list')).records[0]; assert.equal(record.anchor.exact, quote); assert.ok(record.bilingual.variants.some(v => v.language === 'en' && v.scope === 'selection'));
    assert.equal(record.note, '心理安全感是促进团队创意的因素。');
    console.log('PASS: manual second-language binding preserves primary excerpt and notes and refines paragraph to exact English selection');
    await translate(); await page.locator('#retry').click();
    const prepared = await worker.evaluate(async ({ quote, url }) => {
      const tab = (await chrome.tabs.query({})).find(t => t.url === url);
      const doc = await chrome.tabs.sendMessage(tab.id, { type: 'moji:readDocument' });
      return chrome.tabs.sendMessage(tab.id, { type: 'moji:prepareAiHighlights', expectedText: doc.value.text, passages: [{ quote, color: 'blue', label: 'Codex 双语', note: '原文依据。' }], colors: ['yellow', 'blue', 'green', 'rose', 'purple'] });
    }, { quote: '心理安全感鼓励团队成员', url: page.url() });
    assert.equal(prepared.ok, true); assert.ok(prepared.value.items[0].bilingual.variants.some(v => v.language === 'en'));
    const created = await worker.evaluate(async ({ items, pageKey }) => {
      const batch = await repo.createAiBatch({ batchId: 'bilingual-ai-browser', pageKey, title: 'Bilingual', label: 'Codex 双语', items }); notifyChanged(); return batch;
    }, { items: prepared.value.items, pageKey: page.url() });
    assert.equal(created.createdCount, 1);
    const backup = await rpc('export'); assert.ok(backup.payload.records.every(r => r.bilingual.variants.length));
    await page.screenshot({ path: 'artifacts/bilingual-annotations.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: real content-script Codex preparation and AI batch persist bilingual evidence; complete backup includes both languages');
  } finally { await context?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
