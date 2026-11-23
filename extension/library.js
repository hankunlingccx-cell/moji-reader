(() => {
  'use strict';
  MojiInfo.install(document);
  const $ = id => document.getElementById(id);
  const make = (tag, value = '', className) => { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; return e; };
  const button = (value, fn, cls = 'small-button') => { const e = make('button', value, cls); e.addEventListener('click', fn); return e; };
  let palette = MojiPalette.defaults(), colors = MojiPalette.display(palette), paletteDirty = false, paletteEditRevision = 0;
  let records = [], draftList = [], selectedId = null, selectedPage = null, displayedPage = null, mode = 'all', dirty = false, draftChain = Promise.resolve();
  async function rpc(type, fields = {}) { const r = await chrome.runtime.sendMessage({ type: 'moji:' + type, ...fields }); if (!r?.ok) throw new Error(r?.error || '无法连接插件。'); return r.value; }
  function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
  function fail(e) { status(e.message, true); }
  async function refresh(renderSelected = false) {
    const data = await rpc('list'); records = data.records; draftList = data.draftList;
    palette = MojiPalette.validate(data.palette); colors = MojiPalette.display(palette);
    for (const key of MojiPalette.KEYS) $('color').querySelector(`option[value="${key}"]`).textContent = colors[key].name;
    if (!paletteDirty) renderPaletteForm();
    $('count').textContent = records.filter(r => !r.deleted).length; $('trash-count').textContent = records.filter(r => r.deleted).length; $('draft-count').textContent = draftList.length;
    $('backup-state').textContent = data.lastExportAt ? `上次备份：${new Date(data.lastExportAt).toLocaleString()}` : '尚无备份';
    if (renderSelected) { selectedId = null; dirty = false; }
    renderList();
  }
  function renderList() {
    const results = $('results'); results.replaceChildren(); const needle = $('search').value.toLocaleLowerCase(), color = $('color').value;
    const items = records.filter(r => {
      if (mode === 'trash' ? !r.deleted : mode === 'all' && r.deleted) return false;
      if (mode === 'drafts' && !draftList.some(d => d.recordId === r.id)) return false;
      if (color !== 'all' && r.color !== color) return false;
      return !needle || [r.title, r.pageKey, r.anchor.exact, r.note, r.label, ...draftList.filter(d => d.recordId === r.id).map(d => d.note + d.label)].some(v => v.toLocaleLowerCase().includes(needle));
    }).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!items.length) results.append(make('div', mode === 'all' ? '选中网页文字，开始留下第一条标注。' : '这里还没有记录。', 'empty'));
    const groups = new Map();
    for (const r of items) {
      if (!groups.has(r.pageKey)) groups.set(r.pageKey, []);
      groups.get(r.pageKey).push(r);
    }
    if (!groups.has(selectedPage)) selectedPage = groups.keys().next().value || null;
    $('pages-heading').textContent = `${mode === 'trash' ? '回收站中的网页' : mode === 'drafts' ? '有草稿的网页' : '有标注的网页'} · ${groups.size}`;
    for (const [sourceUrl, annotations] of groups) {
      const group = make('article', '', 'source-group' + (selectedPage === sourceUrl ? ' selected' : '')); group.dataset.sourceUrl = sourceUrl;
      const title = annotations[0].title || new URL(sourceUrl).hostname || '本地文档';
      const choose = button('', async () => {
        await draftChain.catch(() => {}); selectedPage = sourceUrl; selectedId = null; dirty = false; renderList(); $('detail').scrollTop = 0;
      }, 'page-item');
      choose.setAttribute('aria-pressed', String(selectedPage === sourceUrl));
      choose.append(make('span', title, 'page-item-title'), make('span', `${annotations.length} 条标注`, 'page-item-count'));
      const info = make('div', '', 'page-item-source'), address = make('span', new URL(sourceUrl).hostname || sourceUrl, 'source-address'), link = make('a', '原文 ↗', 'article-source');
      address.title = sourceUrl; link.href = sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = sourceUrl; link.setAttribute('aria-label', '打开原文：' + title);
      info.append(address, link); group.append(choose, info); results.append(group);
    }
    renderAnnotations(groups.get(selectedPage) || []);
  }
  function renderAnnotations(items) {
    const list = $('annotations');
    if (displayedPage !== selectedPage) {
      displayedPage = selectedPage; selectedId = null; dirty = false; list.replaceChildren(); $('detail').scrollTop = 0;
      const header = $('article-header'); header.replaceChildren();
      if (selectedPage) {
        const title = make('h2', '', 'article-title'); title.id = 'article-title';
        const meta = make('div', '', 'article-list-meta'); meta.id = 'article-list-meta';
        const link = make('a', selectedPage, 'detail-source-link'); link.href = selectedPage; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = '打开原文';
        header.append(title, meta, link);
      }
    }
    $('article-header').hidden = !selectedPage;
    if (!selectedPage) {
      list.replaceChildren(make('div', '选择网页', 'empty')); return;
    }
    $('article-title').textContent = items[0]?.title || new URL(selectedPage).hostname || '本地文档';
    $('article-list-meta').textContent = `${items.length} 条${mode === 'trash' ? '已删除' : ''}标注${$('search').value || $('color').value !== 'all' ? ' · 筛选结果' : ''}`;
    const sorted = [...items].sort((a, b) => a.anchor.start - b.anchor.start || a.createdAt - b.createdAt);
    const ids = new Set(sorted.map(r => r.id));
    if (selectedId && !ids.has(selectedId)) selectedId = null;
    for (const child of [...list.children]) if (!ids.has(child.dataset.recordId)) child.remove();
    sorted.forEach((r, index) => {
      let card = [...list.children].find(node => node.dataset.recordId === r.id);
      if (!card) {
        card = make('article', '', 'annotation-card'); card.dataset.recordId = r.id;
        const top = make('div', '', 'record-top'); top.append(make('span', '', 'dot'), make('span', '', 'annotation-color'), make('span', '', 'record-date'));
        const actions = make('div', '', 'annotation-actions');
        const edit = button('编辑笔记', async () => {
          await draftChain.catch(() => {});
          if (selectedId === r.id) { selectedId = null; renderList(); }
          else showDetail(r.id);
        }); edit.classList.add('edit-annotation');
        const versions = button('历史版本', async () => { await draftChain.catch(() => {}); showDetail(r.id, true); });
        const remove = button('', async () => {
          try { await draftChain; const current = records.find(item => item.id === r.id); await mutate(current, { deleted: !current.deleted }, current.deleted ? 'restore' : 'delete'); await refresh(true); }
          catch (error) { fail(error); }
        }); remove.classList.add('delete-annotation'); actions.append(edit, versions, remove);
        const editor = make('div', '', 'annotation-editor'); editor.hidden = true;
        card.append(top, make('blockquote', '', 'annotation-quote'), make('div', '', 'annotation-label'), make('div', '', 'annotation-note'), make('div', '', 'annotation-badges'), actions, editor);
      }
      card.classList.toggle('selected', selectedId === r.id);
      card.querySelector('.dot').style.background = colors[r.color].hex;
      card.querySelector('.annotation-color').textContent = colors[r.color].name;
      card.querySelector('.record-date').textContent = new Date(r.updatedAt).toLocaleString();
      card.querySelector('.annotation-quote').textContent = r.anchor.exact;
      const label = card.querySelector('.annotation-label'); label.textContent = r.label; label.hidden = !r.label;
      const note = card.querySelector('.annotation-note'); note.textContent = r.note || ''; note.hidden = !r.note; note.classList.toggle('no-note', !r.note);
      const badges = card.querySelector('.annotation-badges'); badges.replaceChildren();
      if (draftList.some(d => d.recordId === r.id)) badges.append(make('span', '有草稿', 'tag'));
      if (r.importedFrom) badges.append(make('span', '导入的冲突副本', 'tag'));
      if (r.aiBatchId) badges.append(make('span', 'Codex · ' + (r.aiBatchLabel || '自动标注'), 'tag'));
      card.querySelector('.edit-annotation').textContent = selectedId === r.id ? '收起编辑' : '编辑笔记';
      card.querySelector('.delete-annotation').textContent = r.deleted ? '恢复记录' : '移入回收站';
      const editor = card.querySelector('.annotation-editor');
      if (selectedId !== r.id && !editor.hidden) { editor.hidden = true; editor.replaceChildren(); }
      // Keep the focused editor in place while autosave refreshes its preview.
      if (list.children[index] !== card) list.insertBefore(card, list.children[index] || null);
    });
  }
  async function mutate(record, patch, kind) {
    const latest = records.find(r => r.id === record.id) || record;
    const result = await rpc('mutate', { id: record.id, baseRevision: latest.revision, patch, kind, opId: crypto.randomUUID() });
    status('已保存到本地。'); return result;
  }
  function showDetail(id, openHistory = false) {
    const r = records.find(r => r.id === id); if (!r) return; selectedId = id; dirty = false;
    renderList();
    const card = [...$('annotations').children].find(node => node.dataset.recordId === id); if (!card) return;
    const thisDraft = { id: crypto.randomUUID(), sequence: 0 };
    const detail = card.querySelector('.annotation-editor'); detail.hidden = false; detail.replaceChildren();
    const label = make('label', '标签', 'field'); label.htmlFor = 'edit-label'; const labelInput = make('input'); labelInput.id = 'edit-label'; labelInput.maxLength = 200; labelInput.value = r.label;
    const noteLabel = make('label', '笔记', 'field'); noteLabel.htmlFor = 'edit-note'; const note = make('textarea'); note.id = 'edit-note'; note.maxLength = 100000; note.value = r.note;
    const noteHeading = make('div', '', 'field-row'); noteHeading.append(noteLabel, MojiInfo.create(document, '笔记保存说明', '输入后自动保存；版本冲突时输入保留为独立草稿。'));
    const state = make('div', '', 'draft-state'); state.setAttribute('role', 'status');
    function draftChanged() {
      dirty = true; state.textContent = '正在自动保存…'; const value = { label: labelInput.value, note: note.value }, sequence = ++thisDraft.sequence;
      const write = rpc('autosave', { id, draftId: thisDraft.id, baseRevision: r.revision, sequence, ...value }).then(result => {
        if (result.conflict) {
          draftList = draftList.filter(d => d.draftId !== thisDraft.id); draftList.push(result.draft);
          state.textContent = '其他窗口已修改此标注；你的输入已保留为独立草稿。'; status('自动保存遇到版本冲突，草稿已保留。', true); return;
        }
        const local = records.find(item => item.id === id);
        if (!local || local.revision <= result.record.revision) { records = records.filter(item => item.id !== id); records.push(result.record); }
        if (sequence === thisDraft.sequence) state.textContent = '已自动保存';
        renderList();
      }).catch(e => { state.textContent = '自动保存失败，请保留输入并继续编辑重试。'; fail(e); throw e; });
      draftChain = Promise.all([draftChain.catch(() => {}), write]).then(() => {}); draftChain.catch(() => {});
    }
    labelInput.addEventListener('input', draftChanged); note.addEventListener('input', draftChanged);
    detail.append(label, labelInput, noteHeading, note, state);
    const actions = make('div', '', 'detail-actions');
    actions.append(button(r.deleted ? '恢复记录' : '移入回收站', async () => { try { await draftChain; await mutate(r, { deleted: !r.deleted }, r.deleted ? 'restore' : 'delete'); dirty = false; await refresh(true); } catch (e) { fail(e); } }, 'secondary' + (r.deleted ? '' : ' danger')));
    if (r.deleted) { labelInput.disabled = true; note.disabled = true; state.textContent = '已在回收站'; }
    detail.append(actions);
    for (const v of r.bilingual?.variants || []) if (v.anchor.exact !== r.anchor.exact) detail.append(make('h3', `${v.language === 'en' ? '英文原文' : '中文译文'} · ${v.scope === 'paragraph' ? '对应段落（非逐词对齐）' : '精确摘录'}`, 'subheading'), make('blockquote', v.anchor.exact, 'detail-quote'));
    if (r.originalQuote && r.originalQuote !== r.anchor.exact) { detail.append(make('h3', '最初标记的原文', 'subheading'), make('blockquote', r.originalQuote, 'detail-quote')); }
    const ownDrafts = draftList.filter(d => d.recordId === id).sort((a, b) => b.at - a.at);
    if (ownDrafts.length) {
      detail.append(make('h3', '保留的草稿', 'subheading'));
      for (const d of ownDrafts) {
        const box = make('div', '', 'draft-box'); box.append(make('div', `草稿 · ${new Date(d.at).toLocaleString()}`, 'meta'), make('div', d.label || '无标签', 'tag'), make('p', d.note || '无笔记'));
        box.append(button('载入编辑区', () => { labelInput.value = d.label; note.value = d.note; draftChanged(); status('草稿已载入，原草稿仍保留。'); }), button('永久丢弃草稿', async () => { try { await rpc('clearDraft', { draftId: d.draftId, expectedAt: d.at }); box.remove(); await refresh(false); } catch (e) { fail(e); } })); detail.append(box);
      }
    }
    const historySection = make('details', '', 'annotation-history'), heading = make('summary', '历史版本'), history = make('div', '正在读取…', 'meta');
    historySection.open = openHistory; historySection.append(heading, history); detail.append(historySection);
    rpc('history', { id }).then(versions => {
      if (!history.isConnected) return; history.replaceChildren(); history.className = '';
      for (const e of versions) {
        const box = make('div', '', 'history-entry'); box.append(make('div', `${new Date(e.at).toLocaleString()} · ${e.kind} · v${e.record.revision}`, 'meta'), make('div', e.record.anchor.exact.slice(0, 240), 'history-quote'), make('div', e.record.label || '无标签', 'tag'), make('div', e.record.note || '无笔记', 'history-note'));
        box.append(button('恢复此版本', async () => { try { await draftChain; await mutate(r, { ...e.record, deleted: false }, 'version-restore'); dirty = false; await refresh(true); } catch (error) { fail(error); } })); history.append(box);
      }
    }).catch(fail);
  }
  function setMode(next) { mode = next; $('heading').textContent = { all: '标注库', drafts: '笔记草稿', trash: '回收站' }[next]; for (const name of ['all', 'drafts', 'trash']) $('nav-' + name).classList.toggle('selected', name === next); renderList(); }
  function renderPaletteForm(value = palette) {
    paletteEditRevision = palette.revision; $('palette-rows').replaceChildren();
    MojiPalette.KEYS.forEach((key, index) => {
      const row = make('div', '', 'palette-row'), color = make('input'), meaning = make('input');
      color.type = 'color'; color.value = value.colors[key].hex; color.id = 'palette-color-' + key; color.setAttribute('aria-label', `标记 ${index + 1} 的颜色`);
      meaning.type = 'text'; meaning.value = value.colors[key].name; meaning.id = 'palette-name-' + key; meaning.maxLength = 12; meaning.required = true; meaning.placeholder = '简短含义'; meaning.setAttribute('aria-label', `标记 ${index + 1} 的含义`);
      for (const input of [color, meaning]) input.addEventListener('input', () => { paletteDirty = true; $('palette-status').textContent = '尚未保存'; });
      row.append(make('span', `标记 ${index + 1}`, 'palette-number'), color, meaning); $('palette-rows').append(row);
    });
  }
  $('palette-form').addEventListener('submit', async event => {
    event.preventDefault(); const b = $('palette-save'); b.disabled = true;
    try {
      const configured = Object.fromEntries(MojiPalette.KEYS.map(key => [key, { name: $('palette-name-' + key).value, hex: $('palette-color-' + key).value }]));
      palette = await rpc('palette', { palette: { colors: configured }, baseRevision: paletteEditRevision }); paletteDirty = false;
      await refresh(false); $('palette-status').className = ''; $('palette-status').textContent = '已保存，网页中的标记会同步更新。';
    } catch (error) { $('palette-status').className = 'error'; $('palette-status').textContent = error.message; }
    finally { b.disabled = false; }
  });
  $('palette-reset').addEventListener('click', () => { renderPaletteForm(MojiPalette.defaults()); paletteDirty = true; $('palette-status').textContent = '已载入默认配色，保存后生效。'; });
  for (const name of ['all', 'drafts', 'trash']) $('nav-' + name).addEventListener('click', () => setMode(name));
  $('search').addEventListener('input', renderList); $('color').addEventListener('change', renderList);
  $('export-ai').addEventListener('click', async () => {
    const b = $('export-ai'); b.disabled = true;
    try { await draftChain; const data = await rpc('list'); MojiAiExport.open(data, { pageKey: selectedPage }); }
    catch (error) { fail(error); } finally { b.disabled = false; }
  });
  $('export').addEventListener('click', async () => {
    const b = $('export'); b.disabled = true;
    try {
      await draftChain; const backup = await rpc('export'); const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = make('a'); link.href = url; link.download = `墨迹备份-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      await rpc('exported'); await refresh(false); status('已发起备份下载，请确认文件已下载完成，并另存一份。');
    } catch (error) { fail(error); } finally { b.disabled = false; }
  });
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async () => {
    const file = $('import-file').files[0]; if (!file) return; const b = $('import'); b.disabled = true;
    try {
      if (file.size > 200 * 1024 * 1024) throw new Error('备份文件超过 200 MB，请先分批迁移。');
      await draftChain; const result = await rpc('import', { backup: JSON.parse(await file.text()) });
      await refresh(false); status(`导入完成：新增 ${result.added} 条，保留 ${result.conflicts} 条冲突副本；已有内容未覆盖。${result.paletteConflict ? ' 颜色设置有冲突，已保留本机设置。' : ''}`);
    } catch (error) { fail(error); } finally { b.disabled = false; $('import-file').value = ''; }
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && Object.keys(changes).some(k => k.startsWith('moji:record:') || k === 'moji:palette')) refresh(false).catch(fail); });
  window.addEventListener('focus', () => refresh(false).catch(fail));
  if (location.hash === '#palette') { $('palette-settings').open = true; requestAnimationFrame(() => $('palette-settings').scrollIntoView({ block: 'start' })); }
  refresh().catch(fail);
})();
