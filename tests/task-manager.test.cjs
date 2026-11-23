const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { JSDOM } = require('jsdom');
const A = require('../extension/anchor.js'), Article = require('../extension/article.js');
async function setup(t, run) {
  const { TaskManager } = await import('../bridge/tasks.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moji-task-test-'));
  const index = A.buildIndex(new JSDOM('<main><h2>Results</h2><p>Psychological safety encourages team members to share unusual ideas.</p><p>Resource limitations reduce opportunities for experimentation.</p></main>').window.document);
  const calls = [], doc = { url: 'https://example.org/paper', tabId: 1, text: index.text, structure: Article.extract(index), sourceHash: 'a'.repeat(64), colors: {}, title: 'Test paper' };
  const options = { storePath: path.join(dir, 'tasks.json'), callExtension: async (method, args) => { calls.push({ method, args }); if (method === 'article.read') return doc; if (method === 'batch.apply') return { id: args.batchId, createdCount: args.passages.length, skipped: [], rejected: args.preRejected || [] }; if (method === 'task.undo') return { undoneCount: 2 }; return {}; }, runnerFactory: options => ({ run: args => run(options, args), close() {}, async interrupt() {} }) };
  const manager = new TaskManager(options); t.after(() => manager.close());
  return { manager, calls, options, doc, start: (id = 'task-1') => manager.start({ id, tabId: 1, url: doc.url, prompt: '标出影响团队创意的因素。' }) };
}
test('independent reading tasks use numbered evidence, persist metadata without full text, and undo every batch', async t => {
  const { manager, start, calls, options } = await setup(t, async ({ onTool }) => {
    await onTool('moji_article_outline', {}); const page = await onTool('moji_read_article', {});
    for (const p of page.paragraphs) await onTool('moji_highlight_passages', { selections: [{ paragraphId: p.id, sentenceNumbers: [1], label: '因素', note: '直接证据。' }] });
    return { status: 'completed' };
  });
  const task = await start(); await manager.tasks.get(task.id).runPromise;
  const saved = (await manager.latest(task.url))[0]; assert.equal(saved.status, 'completed'); assert.equal(saved.createdCount, 2); assert.equal(saved.batchIds.length, 2);
  assert.ok(calls.filter(c => c.method === 'batch.apply').every(c => c.args.taskId === task.id));
  const disk = await fs.readFile(options.storePath, 'utf8'); assert.ok(!disk.includes('Psychological safety')); assert.ok(!disk.includes('sourceHash'));
  const undone = await manager.undo(task.id, task.url); assert.equal(undone.status, 'undone'); assert.equal(undone.undoneCount, 2);
});
test('duplicate starts are idempotent and concurrent jobs do not create additional Codex sessions', async t => {
  let finish; const { manager, start } = await setup(t, () => new Promise(resolve => { finish = resolve; }));
  const a = await start(); assert.equal((await start()).id, a.id); await assert.rejects(start('task-2'), /已有阅读任务/);
  while (!finish) await new Promise(r => setTimeout(r, 5)); finish({ status: 'completed' }); await manager.tasks.get(a.id).runPromise;
});
test('stopping blocks further repository writes before interrupting the independent session', async t => {
  let reader, finish;
  const { manager, start, calls } = await setup(t, ({ onTool }) => { reader = onTool; return new Promise(resolve => { finish = resolve; }); });
  const task = await start(); while (!reader) await new Promise(r => setTimeout(r, 5));
  const stopped = await manager.stop(task.id, task.url); assert.equal(stopped.status, 'stopped'); assert.ok(calls.some(c => c.method === 'task.block'));
  await assert.rejects(reader('moji_read_article', {}), /已停止/); finish({ status: 'interrupted' }); await manager.tasks.get(task.id).runPromise;
});
test('unread paragraphs and unexpected tools cannot be used to write to another document', async t => {
  const { manager, start, calls } = await setup(t, async ({ onTool }) => {
    const rejected = await onTool('moji_highlight_passages', { selections: [{ paragraphId: 'p1' }] }); assert.equal(rejected.createdCount, 0);
    await assert.rejects(onTool('shell', { cmd: 'not permitted' }), /仅允许/); return { status: 'completed' };
  });
  const task = await start(); await manager.tasks.get(task.id).runPromise; assert.ok(!calls.some(c => c.method === 'batch.apply'));
  await assert.rejects(manager.undo(task.id, 'https://example.org/other'), /未找到/);
});
test('connector restart marks unfinished jobs stopped and retains their undo identity', async t => {
  const { manager, options, start } = await setup(t, () => new Promise(() => {}));
  const task = await start(); while (manager.tasks.get(task.id).status === 'starting') await new Promise(r => setTimeout(r, 5)); await manager.saves;
  const { TaskManager } = await import('../bridge/tasks.mjs'), restarted = new TaskManager(options); await restarted.ready;
  assert.equal((await restarted.latest(task.url))[0].status, 'stopped'); assert.equal((await restarted.undo(task.id, task.url)).status, 'undone');
});
test('a model reply without reading evidence is reported as failed rather than a successful zero-annotation task', async t => {
  const { manager, start } = await setup(t, async () => ({ status: 'completed' }));
  const task = await start(); await manager.tasks.get(task.id).runPromise;
  const saved = (await manager.latest(task.url))[0]; assert.equal(saved.status, 'failed'); assert.match(saved.message, /未能读取正文/);
});
test('stop during initial page preparation never starts a late Codex session', async t => {
  let release, launched = 0;
  const { manager, start, doc } = await setup(t, async () => { launched++; return { status: 'completed' }; });
  manager.callExtension = async method => method === 'article.read' ? new Promise(resolve => { release = resolve; }) : {};
  const task = await start(); while (!release) await new Promise(r => setTimeout(r, 5));
  await manager.stop(task.id, task.url); release(doc); await manager.tasks.get(task.id).runPromise;
  assert.equal(launched, 0); assert.equal((await manager.latest(task.url))[0].status, 'stopped');
});
