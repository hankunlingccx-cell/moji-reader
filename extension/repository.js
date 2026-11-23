(function (root) {
  'use strict';
  const PREFIX = 'moji:';
  const Palette = root.MojiPalette || (typeof require === 'function' ? require('./palette.js') : null);
  const COLORS = ['yellow', 'blue', 'green', 'rose', 'purple'];
  const clone = value => JSON.parse(JSON.stringify(value));
  // Chrome storage does not promise object property order. Compare canonical data,
  // never raw JSON.stringify output from the pre-write and post-read objects.
  const stable = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  function validateAnchor(a) {
    if (!a || typeof a.exact !== 'string' || !a.exact.length || a.exact.length > 20000 || typeof a.prefix !== 'string' || a.prefix.length > 80 || typeof a.suffix !== 'string' || a.suffix.length > 80 || !Number.isSafeInteger(a.start) || a.start < 0 || !Number.isSafeInteger(a.end) || a.end <= a.start) throw new Error('原文定位信息无效。');
  }
  function validateBilingual(value) {
    if (value == null) return;
    if (value.version !== 1 || !Array.isArray(value.variants) || value.variants.length > 8) throw new Error('双语定位信息无效。');
    for (const v of value.variants) {
      if (!['en', 'zh'].includes(v.language) || !['selection', 'paragraph'].includes(v.scope)) throw new Error('双语定位范围无效。');
      validateAnchor(v.anchor);
    }
  }
  function mergeBilingual(...values) {
    const variants = [];
    for (const value of values) for (const v of value?.variants || []) if (!variants.some(x => x.language === v.language && x.scope === v.scope && x.anchor.exact === v.anchor.exact && x.anchor.prefix === v.anchor.prefix && x.anchor.suffix === v.anchor.suffix)) variants.push(clone(v));
    return { version: 1, variants: variants.slice(-8) };
  }
  function validateRecord(r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !/^[\w-]{1,100}$/.test(r.id)) throw new Error('标注 ID 无效。');
    const url = new URL(r.pageKey);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('不支持此网页地址。');
    for (const [key, max] of [['title', 1000], ['label', 200], ['note', 100000]]) if (typeof r[key] !== 'string' || r[key].length > max) throw new Error('标注内容格式不正确：' + key);
    if (!COLORS.includes(r.color) || !r.styles || ['highlight', 'underline', 'bold'].some(k => typeof r.styles[k] !== 'boolean')) throw new Error('标记样式无效。');
    validateAnchor(r.anchor); validateBilingual(r.bilingual);
    if (!Number.isSafeInteger(r.revision) || r.revision < 1 || typeof r.deleted !== 'boolean' || !Number.isFinite(r.createdAt) || !Number.isFinite(r.updatedAt)) throw new Error('标注版本信息无效。');
    return r;
  }
  function semantic(r) {
    const c = clone(r); for (const k of ['revision', 'updatedAt', 'createdAt', 'importedFrom']) delete c[k];
    return stable(c);
  }
  class Repository {
    constructor(storage) { this.storage = storage; this.tail = Promise.resolve(); }
    serial(fn) { const p = this.tail.then(fn); this.tail = p.catch(() => {}); return p; }
    async all() {
      const data = await this.storage.get(null), records = new Map();
      // Events also rebuild the latest record if its materialized copy is absent.
      for (const [k, v] of Object.entries(data)) {
        const r = k.startsWith(PREFIX + 'record:') ? v : k.startsWith(PREFIX + 'event:') ? v.record : null;
        if (r) {
          validateRecord(r);
          if (!records.has(r.id) || records.get(r.id).revision < r.revision) records.set(r.id, r);
        }
      }
      for (const r of records.values()) {
        const learned = data[PREFIX + 'bilingual:' + r.id];
        if (learned && stable(learned.anchor) === stable(r.anchor)) {
          validateBilingual(learned.bilingual); r.bilingual = mergeBilingual(r.bilingual, learned.bilingual);
        }
      }
      return { data, records };
    }
    async learnBilingual({ id, anchor, bilingual }) {
      return this.serial(async () => {
        validateAnchor(anchor); validateBilingual(bilingual);
        const { records } = await this.all(), record = records.get(id);
        if (!record || record.deleted || stable(record.anchor) !== stable(anchor) || !bilingual) return null;
        const merged = mergeBilingual(record.bilingual, bilingual);
        if (stable(merged) === stable(record.bilingual)) return merged;
        // Supplementary evidence does not advance the user's note revision or
        // invalidate an active autosave session. Export folds it into the record.
        const key = PREFIX + 'bilingual:' + id, value = { anchor: clone(anchor), bilingual: merged };
        await this.storage.set({ [key]: value });
        if (stable((await this.storage.get(key))[key]) !== stable(value)) throw new Error('双语定位保存校验失败，请重试。');
        return merged;
      });
    }
    async list(pageKey) {
      await this.tail; const { records, data } = await this.all();
      const draftList = Object.entries(data).filter(([k]) => k.startsWith(PREFIX + 'draft:')).map(([k, v]) => ({ ...v, draftId: k.slice((PREFIX + 'draft:').length) }));
      const drafts = {};
      for (const d of draftList) if (!drafts[d.recordId] || drafts[d.recordId].at < d.at) drafts[d.recordId] = d;
      return { records: [...records.values()].filter(r => !pageKey || r.pageKey === pageKey), drafts, draftList, palette: data[PREFIX + 'palette'] ? Palette.validate(data[PREFIX + 'palette']) : Palette.defaults(), lastExportAt: data[PREFIX + 'lastExportAt'] || null };
    }
    async setPalette({ palette, baseRevision }) {
      return this.serial(async () => {
        const key = PREFIX + 'palette', data = await this.storage.get(key), old = data[key] || Palette.defaults();
        if (old.revision !== baseRevision) throw new Error('颜色设置已在其他窗口更新，请重新打开颜色设置后再修改。');
        const value = Palette.validate({ ...palette, revision: old.revision + 1 });
        await this.storage.set({ [key]: value });
        if (stable((await this.storage.get(key))[key]) !== stable(value)) throw new Error('颜色设置保存校验失败，请重试。');
        return value;
      });
    }
    async createAiBatch({ batchId, pageKey, title, label, task = '', taskId, items, rejected = [] }) {
      return this.serial(async () => {
        if (!/^[\w-]{1,80}$/.test(batchId || '') || typeof pageKey !== 'string' || !['http:', 'https:', 'file:'].includes(new URL(pageKey).protocol) || typeof title !== 'string' || title.length > 1000 || typeof label !== 'string' || !label.trim() || label.length > 200 || typeof task !== 'string' || task.length > 10000 || !Array.isArray(items) || items.length > 200 || !Array.isArray(rejected) || rejected.length > 200) throw new Error('批量标注参数无效。');
        if (taskId !== undefined && !/^[\w-]{1,80}$/.test(taskId)) throw new Error('阅读任务编号无效。');
        const signature = await root.MojiRepository.checksum({ pageKey, title, label, task, items, rejected, ...(taskId ? { taskId } : {}) });
        const { data, records } = await this.all(), batchKey = PREFIX + 'batch:' + batchId;
        if (taskId && data[PREFIX + 'taskBlocked:' + taskId]) throw new Error('此任务已停止或撤销，不再写入标注。');
        if (data[batchKey]) {
          if (data[batchKey].signature !== signature) throw new Error('该批次 ID 已用于另一组标注。');
          return { ...data[batchKey], replayed: true };
        }
        const now = Date.now(), writes = {}, recordIds = [], skipped = [];
        const existing = [...records.values()].filter(r => r.pageKey === pageKey && !r.deleted && r.styles.highlight);
        for (const item of items) {
          const duplicate = existing.find(r => r.anchor.start === item.anchor.start && r.anchor.end === item.anchor.end && r.anchor.exact === item.anchor.exact);
          if (duplicate) { skipped.push({ index: item.index, recordId: duplicate.id, reason: '该原文位置已有高亮，未覆盖原有标签或笔记。' }); continue; }
          const id = crypto.randomUUID();
          const record = validateRecord({ id, pageKey, title, anchor: clone(item.anchor), ...(item.bilingual ? { bilingual: clone(item.bilingual) } : {}), ...(taskId ? { aiTaskId: taskId } : {}), originalQuote: item.anchor.exact, color: item.color, label: item.label, note: item.note, styles: { highlight: true, underline: false, bold: false }, deleted: false, revision: 1, createdAt: now, updatedAt: now, aiBatchId: batchId, aiBatchLabel: label, aiTask: task, aiSource: 'codex' });
          const eventId = crypto.randomUUID();
          writes[PREFIX + 'record:' + id] = record;
          writes[PREFIX + 'event:' + eventId] = { id: eventId, kind: 'ai-create', recordId: id, at: now, batchId, record };
          recordIds.push(id); existing.push(record);
        }
        const batch = { id: batchId, pageKey, title, label, task, createdAt: now, recordIds, createdCount: recordIds.length, skipped, rejected, signature, status: 'active' };
        writes[batchKey] = batch;
        await this.storage.set(writes);
        const check = await this.storage.get(Object.keys(writes));
        for (const key of Object.keys(writes)) if (stable(check[key]) !== stable(writes[key])) throw new Error('批量保存校验失败；请用相同批次 ID 重试。');
        return clone(batch);
      });
    }
    async blockAiTask(taskId) {
      return this.serial(async () => {
        if (!/^[\w-]{1,80}$/.test(taskId || '')) throw new Error('任务编号无效。');
        const key = PREFIX + 'taskBlocked:' + taskId, value = { at: Date.now() };
        await this.storage.set({ [key]: value });
        if (stable((await this.storage.get(key))[key]) !== stable(value)) throw new Error('任务停止状态保存失败，请重试。');
        return { taskId, blocked: true };
      });
    }
    async undoAiTask(taskId) {
      return this.serial(async () => {
        if (!/^[\w-]{1,80}$/.test(taskId || '')) throw new Error('任务编号无效。');
        const { records } = await this.all(), now = Date.now(), writes = { [PREFIX + 'taskBlocked:' + taskId]: { at: now } }; let undoneCount = 0;
        for (const previous of records.values()) {
          if (previous.aiTaskId !== taskId || previous.deleted) continue;
          const record = { ...previous, deleted: true, revision: previous.revision + 1, updatedAt: now }, eventId = crypto.randomUUID();
          writes[PREFIX + 'record:' + record.id] = record;
          writes[PREFIX + 'event:' + eventId] = { id: eventId, recordId: record.id, kind: 'ai-task-undo', taskId, at: now, record }; undoneCount++;
        }
        await this.storage.set(writes);
        const check = await this.storage.get(Object.keys(writes));
        for (const key of Object.keys(writes)) if (stable(check[key]) !== stable(writes[key])) throw new Error('任务撤销校验失败，请重试。');
        return { taskId, undoneCount };
      });
    }
    async listAiBatches(pageKey) {
      await this.tail; const { records, data } = await this.all(), groups = new Map();
      for (const [key, batch] of Object.entries(data)) if (key.startsWith(PREFIX + 'batch:') && (!pageKey || batch.pageKey === pageKey)) groups.set(batch.id, { id: batch.id, label: batch.label, pageKey: batch.pageKey, title: batch.title, createdAt: batch.createdAt, totalCount: 0, activeCount: 0 });
      // Batch membership is also on each record, so imported backups retain undo.
      for (const r of records.values()) {
        if (!r.aiBatchId || (pageKey && r.pageKey !== pageKey)) continue;
        if (!groups.has(r.aiBatchId)) groups.set(r.aiBatchId, { id: r.aiBatchId, label: r.aiBatchLabel || 'Codex 自动标注', pageKey: r.pageKey, title: r.title, createdAt: r.createdAt, totalCount: 0, activeCount: 0 });
        const batch = groups.get(r.aiBatchId); batch.totalCount++; if (!r.deleted) batch.activeCount++;
      }
      return [...groups.values()].sort((a, b) => b.createdAt - a.createdAt);
    }
    async undoAiBatch(batchId) {
      return this.serial(async () => {
        if (!/^[\w-]{1,80}$/.test(batchId || '')) throw new Error('批次 ID 无效。');
        const { records, data } = await this.all(), all = [...records.values()].filter(r => r.aiBatchId === batchId);
        if (!all.length && !data[PREFIX + 'batch:' + batchId]) throw new Error('未找到该 Codex 标注批次。');
        const writes = {}, now = Date.now(); let undoneCount = 0;
        for (const previous of all) {
          if (previous.deleted) continue;
          const record = { ...previous, deleted: true, revision: previous.revision + 1, updatedAt: now }, eventId = crypto.randomUUID();
          writes[PREFIX + 'record:' + record.id] = record;
          writes[PREFIX + 'event:' + eventId] = { id: eventId, recordId: record.id, kind: 'ai-batch-undo', batchId, at: now, record }; undoneCount++;
        }
        if (data[PREFIX + 'batch:' + batchId]) writes[PREFIX + 'batch:' + batchId] = { ...data[PREFIX + 'batch:' + batchId], status: 'undone', undoneAt: now };
        await this.storage.set(writes);
        const check = await this.storage.get(Object.keys(writes));
        for (const key of Object.keys(writes)) if (stable(check[key]) !== stable(writes[key])) throw new Error('整批撤销保存校验失败，请重试。');
        return { batchId, undoneCount, message: '该批标注已移入回收站，最新标签、笔记和历史仍保留。' };
      });
    }
    async mutate({ id, baseRevision, patch, opId, kind = 'edit' }) {
      return this.serial(async () => {
        if (!/^[\w-]{1,100}$/.test(opId || '')) throw new Error('操作 ID 无效。');
        const eventKey = PREFIX + 'event:' + opId;
        const { data, records } = await this.all();
        if (data[eventKey]) return data[eventKey].record; // Safe retry after a lost response.
        const old = records.get(id);
        if ((old?.revision || 0) !== baseRevision) throw new Error('这条标注已在其他窗口修改。请刷新侧栏后再操作；输入的笔记草稿仍会保留。');
        const now = Date.now();
        const record = validateRecord({ ...old, ...clone(patch), id, createdAt: old?.createdAt || now, updatedAt: now, revision: (old?.revision || 0) + 1 });
        const event = { id: opId, kind, recordId: id, at: now, record };
        await this.storage.set({ [eventKey]: event, [PREFIX + 'record:' + id]: record });
        const check = await this.storage.get(eventKey);
        if (stable(check[eventKey]) !== stable(event)) throw new Error('保存校验未通过，请重试。');
        return clone(record);
      });
    }
    async saveDraft({ id, draft, draftId }) {
      return this.serial(async () => {
        if (!/^[\w-]{1,100}$/.test(id || '') || !/^[\w-]{1,100}$/.test(draftId || '') || typeof draft.note !== 'string' || draft.note.length > 100000 || typeof draft.label !== 'string' || draft.label.length > 200) throw new Error('草稿格式无效。');
        const value = { recordId: id, label: draft.label, note: draft.note, at: Date.now(), baseRevision: draft.baseRevision };
        const key = PREFIX + 'draft:' + draftId;
        await this.storage.set({ [key]: value });
        const check = await this.storage.get(key);
        if (stable(check[key]) !== stable(value)) throw new Error('草稿保存校验未通过，请保留输入并重试。');
        return { ...value, draftId };
      });
    }
    async autoSaveNote({ id, draftId, baseRevision, sequence, label, note }) {
      return this.serial(async () => {
        if (!/^[\w-]{1,100}$/.test(id || '') || !/^[\w-]{1,70}$/.test(draftId || '') || !Number.isSafeInteger(baseRevision) || !Number.isSafeInteger(sequence) || sequence < 1 || typeof note !== 'string' || note.length > 100000 || typeof label !== 'string' || label.length > 200) throw new Error('自动保存内容无效。');
        const { data, records } = await this.all(), old = records.get(id);
        const sessionKey = PREFIX + 'autosession:' + draftId, draftKey = PREFIX + 'draft:' + draftId;
        const session = data[sessionKey];
        if (session && (session.recordId !== id || session.baseRevision !== baseRevision)) throw new Error('自动保存会话无效。');
        if (session && sequence <= session.sequence) return { record: old, ignored: true };
        const expected = session?.revision ?? baseRevision;
        if (!old || old.deleted || old.revision !== expected) {
          const draft = { recordId: id, label, note, baseRevision, sequence, at: Date.now() };
          const previousDraft = data[draftKey];
          if (!previousDraft || (previousDraft.sequence || 0) <= sequence) {
            await this.storage.set({ [draftKey]: draft });
            if (stable((await this.storage.get(draftKey))[draftKey]) !== stable(draft)) throw new Error('冲突草稿保存失败，请保留输入内容。');
          }
          return { conflict: true, draft: { ...draft, draftId } };
        }
        const now = Date.now(), changed = old.note !== note || old.label !== label;
        const record = changed ? validateRecord({ ...old, note, label, revision: old.revision + 1, updatedAt: now }) : old;
        const writes = { [sessionKey]: { recordId: id, baseRevision, revision: record.revision, sequence } };
        if (changed) {
          const opId = draftId + '-' + sequence;
          writes[PREFIX + 'event:' + opId] = { id: opId, recordId: id, kind: 'note-auto', at: now, record };
          writes[PREFIX + 'record:' + id] = record;
        }
        await this.storage.set(writes);
        const check = await this.storage.get(Object.keys(writes));
        for (const key of Object.keys(writes)) if (stable(check[key]) !== stable(writes[key])) throw new Error('自动保存校验未通过，请保留输入并重试。');
        // Only clear this session's previously conflicted draft after its contents
        // are committed. Other windows and recovered drafts are never removed.
        if (data[draftKey]) await this.storage.remove(draftKey);
        return { record };
      });
    }
    async clearDraft(draftId, expectedAt) {
      return this.serial(async () => {
        const key = PREFIX + 'draft:' + draftId, data = await this.storage.get(key);
        if (expectedAt && data[key]?.at === expectedAt) await this.storage.remove(key);
      });
    }
    async history(id) {
      await this.tail; const { data } = await this.all();
      return Object.entries(data).filter(([k, v]) => (k.startsWith(PREFIX + 'event:') || k.startsWith(PREFIX + 'archive:')) && v.recordId === id).map(([, v]) => v).sort((a, b) => b.at - a.at);
    }
    async exportData() {
      await this.tail; const { data, records } = await this.all();
      const payload = { records: [...records.values()], events: Object.entries(data).filter(([k]) => k.startsWith(PREFIX + 'event:') || k.startsWith(PREFIX + 'archive:')).map(([, v]) => v), drafts: Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith(PREFIX + 'draft:')).map(([k, v]) => [k.slice((PREFIX + 'draft:').length), v])), palette: data[PREFIX + 'palette'] || Palette.defaults() };
      const checksum = await root.MojiRepository.checksum(payload);
      return { app: 'moji-reader', schema: 1, exportedAt: new Date().toISOString(), checksum, payload };
    }
    async importData(backup) {
      return this.serial(async () => {
        if (backup?.app !== 'moji-reader' || backup.schema !== 1 || !backup.payload || backup.checksum !== await root.MojiRepository.checksum(backup.payload)) throw new Error('备份格式或校验和不正确，未导入任何内容。');
        const { records: incoming, events, drafts } = backup.payload;
        const importedPalette = backup.payload.palette ? Palette.validate(backup.payload.palette) : null;
        if (!Array.isArray(incoming) || incoming.length > 100000 || !Array.isArray(events) || !drafts || typeof drafts !== 'object' || Array.isArray(drafts)) throw new Error('备份数据无效。');
        const seen = new Set();
        for (const r of incoming) { validateRecord(r); if (seen.has(r.id)) throw new Error('备份存在重复 ID。'); seen.add(r.id); }
        for (const e of events) { validateRecord(e.record); if (e.recordId !== e.record.id || !Number.isFinite(e.at)) throw new Error('备份历史无效。'); }
        for (const [id, d] of Object.entries(drafts)) if (!/^[\w-]{1,100}$/.test(id) || !seen.has(d.recordId) || typeof d.note !== 'string' || d.note.length > 100000 || typeof d.label !== 'string' || d.label.length > 200 || !Number.isFinite(d.at)) throw new Error('备份草稿无效。');
        const { records, data } = await this.all(), writes = {}, mapping = new Map(); let added = 0, conflicts = 0;
        for (const r of incoming) {
          const existing = records.get(r.id);
          if (existing && semantic(existing) === semantic(r)) { mapping.set(r.id, r.id); continue; }
          const id = existing ? crypto.randomUUID() : r.id; mapping.set(r.id, id);
          if (existing) conflicts++;
          const copy = { ...clone(r), id, revision: 1, updatedAt: Date.now(), ...(existing ? { importedFrom: r.id } : {}) };
          const opId = crypto.randomUUID();
          writes[PREFIX + 'event:' + opId] = { id: opId, kind: 'import', recordId: id, at: copy.updatedAt, record: copy };
          writes[PREFIX + 'record:' + id] = copy; added++;
        }
        for (const e of events) {
          const id = mapping.get(e.recordId); if (!id) continue;
          const local = data[PREFIX + 'event:' + e.id];
          if (local?.recordId === id && stable(local.record) === stable(e.record)) continue;
          const key = PREFIX + 'archive:' + id + ':' + (e.id || await root.MojiRepository.checksum(e));
          if (!data[key]) writes[key] = { ...clone(e), recordId: id, record: { ...clone(e.record), id } };
        }
        for (const [oldId, d] of Object.entries(drafts)) {
          const id = mapping.get(d.recordId); if (!id) continue;
          let key = PREFIX + 'draft:' + oldId;
          if (data[key] && data[key].recordId === id && data[key].note === d.note && data[key].label === d.label) continue;
          if (data[key]) key = PREFIX + 'draft:' + crypto.randomUUID();
          writes[key] = { ...clone(d), recordId: id, baseRevision: writes[PREFIX + 'record:' + id]?.revision ?? records.get(id)?.revision };
        }
        let paletteConflict = false;
        if (importedPalette) {
          const localPalette = data[PREFIX + 'palette'] || Palette.defaults();
          if (stable(localPalette.colors) !== stable(importedPalette.colors)) {
            if (localPalette.revision === 0) writes[PREFIX + 'palette'] = { ...importedPalette, revision: 1 };
            else paletteConflict = true;
          }
        }
        // Validate the entire file before a single atomic storage batch. Never replace a conflicting record.
        await this.storage.set(writes);
        const check = await this.storage.get(Object.keys(writes));
        for (const k of Object.keys(writes)) if (stable(check[k]) !== stable(writes[k])) throw new Error('导入校验未通过，请保留备份并重试。');
        return { added, conflicts, paletteConflict };
      });
    }
  }
  async function checksum(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
    return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  root.MojiRepository = { Repository, validateRecord, checksum, COLORS };
  if (typeof module !== 'undefined') module.exports = root.MojiRepository;
})(globalThis);
