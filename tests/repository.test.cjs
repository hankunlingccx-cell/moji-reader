const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Repository, checksum } = require('../extension/repository.js');
class Storage {
  constructor() { this.data = {}; this.fail = false; }
  async get(keys) { if (keys === null) return structuredClone(this.data); const out = {}; for (const k of typeof keys === 'string' ? [keys] : keys) if (k in this.data) out[k] = structuredClone(this.data[k]); return out; }
  async set(value) { if (this.fail) throw new Error('disk full'); Object.assign(this.data, structuredClone(value)); }
  async remove(k) { delete this.data[k]; }
}
function setup() { const storage = new Storage(); return { storage, repo: new Repository(storage) }; }
function patch(note = '') { return { pageKey: 'https://example.org/paper', title: 'Test paper', label: '', note, anchor: { exact: 'Original experiment', prefix: 'The ', suffix: ' was replicated.', start: 4, end: 23, version: 1 }, originalQuote: 'Original experiment', color: 'yellow', styles: { highlight: true, underline: false, bold: false }, deleted: false }; }
const create = (repo, note = '') => repo.mutate({ id: 'record-1', baseRevision: 0, opId: crypto.randomUUID(), kind: 'create', patch: patch(note) });
const bilingualValue = () => ({ version: 1, variants: [{ language: 'zh', scope: 'paragraph', anchor: { exact: '最初实验的中文译文，需要保留笔记和定位信息。', prefix: '', suffix: '', start: 0, end: 25, exactCount: 1, version: 1 } }] });

test('learning bilingual evidence persists without changing note revision or disrupting autosave', async () => {
  const { repo, storage } = setup(), r = await create(repo, 'my note');
  await repo.learnBilingual({ id: r.id, anchor: r.anchor, bilingual: bilingualValue() });
  const saved = (await new Repository(storage).list()).records[0];
  assert.equal(saved.revision, r.revision); assert.equal(saved.note, 'my note'); assert.equal(saved.bilingual.variants.length, 1);
  const write = await repo.autoSaveNote({ id: r.id, draftId: 'bilingual-session', baseRevision: r.revision, sequence: 1, label: '', note: 'new note' });
  assert.equal(write.conflict, undefined); assert.equal(write.record.bilingual.variants.length, 1);
});
test('bilingual evidence is included in checksummed backups and batch creation', async () => {
  const { repo } = setup(); const r = await create(repo);
  await repo.learnBilingual({ id: r.id, anchor: r.anchor, bilingual: bilingualValue() });
  const backup = await repo.exportData(), other = setup(); await other.repo.importData(backup);
  assert.deepEqual((await other.repo.list()).records[0].bilingual, bilingualValue());
  const args = { batchId: 'dual-batch', pageKey: r.pageKey, title: r.title, label: '双语', items: [{ anchor: { ...r.anchor, exact: 'Another independent English result', start: 200, end: 234 }, color: 'green', label: 'tag', note: '批注', bilingual: bilingualValue() }] };
  await repo.createAiBatch(args);
  assert.deepEqual((await repo.list()).records.find(x => x.aiBatchId).bilingual, bilingualValue());
});
test('stale bilingual learning cannot attach evidence to a manually relocated quote', async () => {
  const { repo } = setup(); const r = await create(repo);
  await repo.learnBilingual({ id: r.id, anchor: r.anchor, bilingual: bilingualValue() });
  await repo.mutate({ id: r.id, baseRevision: r.revision, opId: 'new-location', patch: { anchor: { ...r.anchor, exact: 'Completely different experiment', end: 34 }, bilingual: null } });
  assert.equal(await repo.learnBilingual({ id: r.id, anchor: r.anchor, bilingual: bilingualValue() }), null);
  assert.equal((await repo.list()).records[0].bilingual, null);
});
test('malformed bilingual evidence and failed writes are never reported as saved', async () => {
  const { repo, storage } = setup(), r = await create(repo);
  await assert.rejects(repo.learnBilingual({ id: r.id, anchor: r.anchor, bilingual: { version: 1, variants: [{ language: 'unknown' }] } }), /双语/);
  storage.fail = true; await assert.rejects(repo.learnBilingual({ id: r.id, anchor: r.anchor, bilingual: bilingualValue() }), /disk full/);
  storage.fail = false; assert.equal((await repo.list()).records[0].bilingual, undefined);
});
test('committed notes survive worker restart, and history reconstructs missing materialized state', async () => {
  const { storage, repo } = setup(); await create(repo, 'Do not lose this');
  assert.equal((await new Repository(storage).list()).records[0].note, 'Do not lose this');
  delete storage.data['moji:record:record-1'];
  assert.equal((await new Repository(storage).list()).records[0].note, 'Do not lose this');
});
test('lost response retry is idempotent', async () => {
  const { repo } = setup(); const args = { id: 'record-1', baseRevision: 0, opId: 'one-op', patch: patch('note') };
  const a = await repo.mutate(args), b = await repo.mutate(args); assert.deepEqual(a, b); assert.equal((await repo.history(a.id)).length, 1);
});
test('save verification tolerates Chrome storage reordering nested object keys', async () => {
  const { storage } = setup();
  const get = storage.get.bind(storage);
  function reorder(value) { return Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, reorder(value[k])])) : value; }
  storage.get = async keys => reorder(await get(keys));
  const repo = new Repository(storage); assert.equal((await create(repo, 'verified')).note, 'verified');
  await repo.saveDraft({ id: 'record-1', draftId: 'draft-key-order', draft: { label: 'label', note: 'note', baseRevision: 1 } });
  const backup = await repo.exportData(); assert.equal((await setup().repo.importData(backup)).added, 1);
});
test('concurrent edits reject stale versions without overwriting notes', async () => {
  const { repo } = setup(); await create(repo);
  const results = await Promise.allSettled(['first note', 'second note'].map(note => repo.mutate({ id: 'record-1', baseRevision: 1, opId: crypto.randomUUID(), patch: { note } })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await repo.list()).records[0].note, 'first note');
});
test('failed disk write is not reported as saved and same operation can retry', async () => {
  const { repo, storage } = setup(); await create(repo);
  const args = { id: 'record-1', baseRevision: 1, opId: 'retry-op', patch: { note: 'second' } };
  storage.fail = true; await assert.rejects(repo.mutate(args), /disk full/); storage.fail = false;
  assert.equal((await repo.list()).records[0].note, ''); assert.equal((await repo.mutate(args)).note, 'second');
});
test('delete and restore create retained versions', async () => {
  const { repo } = setup(); await create(repo, 'keep me');
  await repo.mutate({ id: 'record-1', baseRevision: 1, opId: 'del', patch: { deleted: true } });
  assert.equal((await repo.list()).records[0].deleted, true);
  await repo.mutate({ id: 'record-1', baseRevision: 2, opId: 'restore', patch: { deleted: false } });
  assert.equal((await repo.list()).records[0].note, 'keep me'); assert.equal((await repo.history('record-1')).length, 3);
});
test('independent windows keep separate drafts and conditional clear preserves newer drafts', async () => {
  const { repo } = setup(); await create(repo);
  await repo.saveDraft({ id: 'record-1', draftId: 'window-a', draft: { label: '', note: 'draft A', baseRevision: 1 } });
  const b = await repo.saveDraft({ id: 'record-1', draftId: 'window-b', draft: { label: '', note: 'draft B', baseRevision: 1 } });
  await repo.clearDraft('window-a', -1); assert.equal((await repo.list()).draftList.length, 2);
  await repo.clearDraft('window-b', b.at); assert.equal((await repo.list()).draftList[0].note, 'draft A');
});
test('backup round trip preserves notes, deleted records, histories and drafts', async () => {
  const source = setup(); await create(source.repo, 'original');
  await source.repo.saveDraft({ id: 'record-1', draftId: 'draft-1', draft: { label: 'tag', note: 'not submitted', baseRevision: 1 } });
  await source.repo.mutate({ id: 'record-1', baseRevision: 1, opId: 'deleted', patch: { deleted: true } });
  const backup = await source.repo.exportData(), target = setup();
  assert.equal((await target.repo.importData(backup)).added, 1);
  const data = await target.repo.list(); assert.equal(data.records[0].note, 'original'); assert.equal(data.records[0].deleted, true); assert.equal(data.draftList[0].note, 'not submitted');
  assert.ok((await target.repo.history('record-1')).length >= 2);
  assert.equal((await target.repo.importData(backup)).added, 0);
});
test('conflicting import retains both records and both drafts', async () => {
  const a = setup(), b = setup(); await create(a.repo, 'local note'); await create(b.repo, 'imported note');
  await a.repo.saveDraft({ id: 'record-1', draftId: 'same-draft', draft: { label: '', note: 'local draft', baseRevision: 1 } });
  await b.repo.saveDraft({ id: 'record-1', draftId: 'same-draft', draft: { label: '', note: 'import draft', baseRevision: 1 } });
  const result = await a.repo.importData(await b.repo.exportData()); assert.equal(result.conflicts, 1);
  const data = await a.repo.list(); assert.deepEqual(data.records.map(r => r.note).sort(), ['imported note', 'local note']); assert.equal(data.draftList.length, 2);
});
test('checksum failure or invalid record imports nothing', async () => {
  const source = setup(); await create(source.repo); const backup = await source.repo.exportData(), target = setup();
  backup.payload.records[0].note = 'tampered'; await assert.rejects(target.repo.importData(backup), /校验和/); assert.equal((await target.repo.list()).records.length, 0);
  backup.payload.records[0].pageKey = 'javascript:alert(1)'; backup.checksum = await checksum(backup.payload);
  await assert.rejects(target.repo.importData(backup), /网页地址/); assert.equal((await target.repo.list()).records.length, 0);
});
test('manual reattachment preserves original excerpt and note in history', async () => {
  const { repo } = setup(); const first = await create(repo, 'my note');
  const updated = await repo.mutate({ id: first.id, baseRevision: 1, opId: 'relink', kind: 'relink', patch: { anchor: { ...first.anchor, exact: 'Rewritten experiment' } } });
  assert.equal(updated.note, 'my note'); assert.equal(updated.originalQuote, 'Original experiment');
  assert.ok((await repo.history(first.id)).some(e => e.record.anchor.exact === 'Original experiment'));
});
test('automatic notes commit directly and survive a new repository instance', async () => {
  const { repo, storage } = setup(); await create(repo);
  const result = await repo.autoSaveNote({ id: 'record-1', draftId: 'editor-one', baseRevision: 1, sequence: 1, label: 'Tag', note: 'No save button needed' });
  assert.equal(result.record.note, 'No save button needed');
  assert.equal((await new Repository(storage).list()).records[0].note, 'No save button needed');
  assert.equal((await repo.list()).draftList.length, 0);
});
test('rapid snapshots of the same editing session advance together without conflicts', async () => {
  const { repo } = setup(); await create(repo);
  const results = await Promise.all([1, 2, 3, 4].map(sequence => repo.autoSaveNote({ id: 'record-1', draftId: 'fast-editor', baseRevision: 1, sequence, label: '', note: 'typed-' + sequence })));
  assert.ok(results.every(result => !result.conflict)); assert.equal((await repo.list()).records[0].note, 'typed-4');
});
test('older and retried autosave snapshots never regress the saved note', async () => {
  const { repo } = setup(); await create(repo);
  const snapshot = { id: 'record-1', draftId: 'ordered-editor', baseRevision: 1, label: '' };
  await repo.autoSaveNote({ ...snapshot, sequence: 2, note: 'newer' });
  const older = await repo.autoSaveNote({ ...snapshot, sequence: 1, note: 'older' });
  const retried = await repo.autoSaveNote({ ...snapshot, sequence: 2, note: 'newer' });
  assert.equal(older.ignored, true); assert.equal(retried.ignored, true); assert.equal((await repo.list()).records[0].note, 'newer');
  assert.equal((await repo.history('record-1')).length, 2);
});
test('autosave conflict preserves independent drafts and cannot silently rebase', async () => {
  const { repo } = setup(); await create(repo);
  await repo.autoSaveNote({ id: 'record-1', draftId: 'window-one', baseRevision: 1, sequence: 1, label: '', note: 'first window' });
  const a = await repo.autoSaveNote({ id: 'record-1', draftId: 'window-two', baseRevision: 1, sequence: 1, label: 'second', note: 'other window' });
  const b = await repo.autoSaveNote({ id: 'record-1', draftId: 'window-two', baseRevision: 1, sequence: 2, label: 'second', note: 'other window continued' });
  assert.equal(a.conflict, true); assert.equal(b.conflict, true);
  const state = await repo.list(); assert.equal(state.records[0].note, 'first window'); assert.equal(state.draftList[0].note, 'other window continued');
});
test('a style change in another session is preserved against automatic notes', async () => {
  const { repo } = setup(); await create(repo);
  await repo.autoSaveNote({ id: 'record-1', draftId: 'note-editor', baseRevision: 1, sequence: 1, label: '', note: 'saved text' });
  await repo.mutate({ id: 'record-1', baseRevision: 2, opId: 'style-update', patch: { styles: { highlight: true, underline: true, bold: true } } });
  assert.equal((await repo.autoSaveNote({ id: 'record-1', draftId: 'note-editor', baseRevision: 1, sequence: 2, label: '', note: 'conflicting text' })).conflict, true);
  const r = (await repo.list()).records[0]; assert.equal(r.styles.bold, true); assert.equal(r.note, 'saved text');
});
test('failed automatic save can retry the same snapshot without duplicate history', async () => {
  const { repo, storage } = setup(); await create(repo);
  const snapshot = { id: 'record-1', draftId: 'retry-editor', baseRevision: 1, sequence: 1, label: '', note: 'retry snapshot' };
  storage.fail = true; await assert.rejects(repo.autoSaveNote(snapshot), /disk full/); storage.fail = false;
  await repo.autoSaveNote(snapshot); await repo.autoSaveNote(snapshot);
  assert.equal((await repo.list()).records[0].note, 'retry snapshot'); assert.equal((await repo.history('record-1')).length, 2);
});
test('custom palette persists across restarts and does not change original records', async () => {
  const { repo, storage } = setup(); await create(repo, 'keep note');
  const palette = (await repo.list()).palette; palette.colors.green = { name: '  证据  ', hex: '#ABCDEF' };
  const saved = await repo.setPalette({ palette, baseRevision: 0 });
  assert.equal(saved.colors.green.name, '证据'); assert.equal(saved.colors.green.hex, '#abcdef');
  const state = await new Repository(storage).list(); assert.equal(state.palette.colors.green.name, '证据'); assert.equal(state.records[0].note, 'keep note'); assert.equal(state.records[0].revision, 1);
});
test('palette version conflict and invalid values cannot overwrite saved settings', async () => {
  const { repo } = setup(), palette = (await repo.list()).palette;
  await repo.setPalette({ palette, baseRevision: 0 });
  await assert.rejects(repo.setPalette({ palette, baseRevision: 0 }), /其他窗口/);
  palette.colors.yellow.hex = 'red; background:url(bad)';
  await assert.rejects(repo.setPalette({ palette, baseRevision: 1 }), /有效颜色/);
  assert.equal((await repo.list()).palette.colors.yellow.hex, '#f3cf63');
});
test('custom palette is included in backups and restores into a fresh profile', async () => {
  const source = setup(), target = setup(), palette = (await source.repo.list()).palette;
  palette.colors.purple = { name: '我的想法', hex: '#123456' }; await source.repo.setPalette({ palette, baseRevision: 0 });
  const backup = await source.repo.exportData(); await target.repo.importData(backup);
  assert.deepEqual((await target.repo.list()).palette.colors.purple, { name: '我的想法', hex: '#123456' });
});
test('import keeps existing custom palette when backup settings conflict', async () => {
  const a = setup(), b = setup();
  for (const [instance, name] of [[a, '本机含义'], [b, '备份含义']]) {
    const palette = (await instance.repo.list()).palette; palette.colors.blue.name = name; await instance.repo.setPalette({ palette, baseRevision: 0 });
  }
  const result = await a.repo.importData(await b.repo.exportData());
  assert.equal(result.paletteConflict, true); assert.equal((await a.repo.list()).palette.colors.blue.name, '本机含义');
});
test('older backups without a palette remain importable', async () => {
  const source = setup(), target = setup(); await create(source.repo, 'old notes');
  const backup = await source.repo.exportData(); delete backup.payload.palette; backup.checksum = await checksum(backup.payload);
  await target.repo.importData(backup); assert.equal((await target.repo.list()).records[0].note, 'old notes'); assert.equal((await target.repo.list()).palette.revision, 0);
});
function aiBatch(id = 'ai-batch-one', quote = 'AI exact original quote') {
  return { batchId: id, pageKey: 'https://example.org/paper', title: 'Paper', label: '团队创意影响因素', task: '高亮团队因素', items: [{ index: 0, color: 'blue', label: '团队因素', note: '原文证据与解释', anchor: { exact: quote, start: 5, end: 5 + quote.length, prefix: 'This ', suffix: ' follows.', exactCount: 1, version: 1 } }], rejected: [] };
}
test('AI batches atomically persist tags, notes, source and membership', async () => {
  const { repo, storage } = setup(); const result = await repo.createAiBatch(aiBatch());
  assert.equal(result.createdCount, 1);
  const record = (await new Repository(storage).list()).records[0];
  assert.equal(record.note, '原文证据与解释'); assert.equal(record.label, '团队因素'); assert.equal(record.aiBatchId, result.id);
  assert.equal((await repo.listAiBatches())[0].activeCount, 1);
});
test('AI batch retry is idempotent and existing manual highlights are never overwritten', async () => {
  const { repo } = setup(); await create(repo, 'manual note');
  const manual = (await repo.list()).records[0], batch = aiBatch(); batch.items.push({ ...batch.items[0], index: 1, anchor: manual.anchor });
  const first = await repo.createAiBatch(batch), retried = await repo.createAiBatch(batch);
  assert.equal(first.createdCount, 1); assert.equal(first.skipped.length, 1); assert.equal(retried.replayed, true);
  assert.equal((await repo.list()).records.length, 2); assert.equal((await repo.list()).records.find(r => r.id === manual.id).note, 'manual note');
  await assert.rejects(repo.createAiBatch({ ...batch, task: 'different' }), /另一组标注/);
});
test('whole-batch undo retains subsequently edited notes and leaves manual or other batches intact', async () => {
  const { repo } = setup(); await create(repo, 'manual');
  const first = await repo.createAiBatch(aiBatch()), second = await repo.createAiBatch(aiBatch('ai-batch-two', 'A different original quote'));
  const id = first.recordIds[0]; await repo.mutate({ id, baseRevision: 1, opId: 'manual-note-edit', patch: { note: '我后来补充的笔记' } });
  assert.equal((await repo.undoAiBatch(first.id)).undoneCount, 1);
  const records = (await repo.list()).records;
  assert.equal(records.find(r => r.id === id).deleted, true); assert.equal(records.find(r => r.id === id).note, '我后来补充的笔记');
  assert.equal(records.find(r => r.id === second.recordIds[0]).deleted, false); assert.equal(records.find(r => r.id === 'record-1').deleted, false);
  assert.equal((await repo.undoAiBatch(first.id)).undoneCount, 0); assert.ok((await repo.history(id)).length >= 3);
});
test('invalid or failed AI writes do not leave a partial batch', async () => {
  const { repo, storage } = setup(), batch = aiBatch();
  batch.items.push({ ...batch.items[0], anchor: { ...batch.items[0].anchor, exact: '' } });
  await assert.rejects(repo.createAiBatch(batch)); assert.equal((await repo.list()).records.length, 0); assert.equal((await repo.listAiBatches()).length, 0);
  storage.fail = true; await assert.rejects(repo.createAiBatch(aiBatch()), /disk full/); storage.fail = false;
  assert.equal((await repo.listAiBatches()).length, 0);
});
test('AI batch undo remains available after backup import and repository restart', async () => {
  const source = setup(), target = setup(); await source.repo.createAiBatch(aiBatch());
  await target.repo.importData(await source.repo.exportData());
  const restarted = new Repository(target.storage), batch = (await restarted.listAiBatches())[0];
  assert.equal(batch.activeCount, 1); assert.equal((await restarted.undoAiBatch(batch.id)).undoneCount, 1);
  assert.equal((await restarted.list()).records[0].note, '原文证据与解释');
});
