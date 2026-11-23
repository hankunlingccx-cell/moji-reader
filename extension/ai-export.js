(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const make = (tag, value = '', className) => { const element = document.createElement(tag); element.textContent = value; if (className) element.className = className; return element; };
  const defaultTask = '请根据这些摘录和我的批注，总结主要观点、比较不同文章的方法，并整理我的疑问。每个结论请注明文章及标注编号；材料没有提供的内容不要自行补全。';
  let snapshot = null, groups = [], selected = new Set(), uiGroups = [], preview = null, exportedAt = '';
  function update() {
    let selectedCount = 0;
    for (const view of uiGroups) {
      const count = view.group.records.filter(record => selected.has(record.id)).length;
      selectedCount += count; view.checkbox.checked = count === view.group.records.length; view.checkbox.indeterminate = count > 0 && count < view.group.records.length;
      view.count.textContent = `${count} / ${view.group.records.length} 条`;
      for (const entry of view.entries) entry.checkbox.checked = selected.has(entry.record.id);
    }
    preview = selectedCount ? MojiMarkdown.build({ ...snapshot, ids: selected, task: $('ai-task').value, exportedAt }) : null;
    $('ai-summary').textContent = preview ? `已选 ${preview.articleCount} 篇网页 · ${preview.annotationCount} 条标注` : '尚未勾选标注';
    $('ai-preview').value = preview?.markdown || '勾选左侧网页或标注后，这里会显示将要下载的 Markdown 内容。';
    $('ai-download').disabled = !preview;
  }
  function render(pageKey) {
    const list = $('ai-selection'); list.replaceChildren(); uiGroups = [];
    if (!groups.length) list.append(make('div', '还没有可导出的标注。', 'empty'));
    for (const [index, group] of groups.entries()) {
      const section = make('section', '', 'ai-page-group'), header = make('div', '', 'ai-page-heading');
      const label = make('label', '', 'ai-page-label'), checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.className = 'ai-page-checkbox'; checkbox.dataset.pageKey = group.url; checkbox.setAttribute('aria-label', '选择网页：' + group.title);
      label.append(checkbox, make('span', group.title, 'ai-page-title'));
      const toggle = make('button', '', 'small-button ai-toggle'); toggle.type = 'button';
      const count = make('span', '', 'ai-page-count');
      header.append(label, count, toggle);
      const address = make('div', group.url, 'ai-page-url'); address.title = group.url;
      const entries = make('div', '', 'ai-page-annotations'); entries.id = 'ai-page-annotations-' + index; entries.hidden = group.url !== pageKey;
      const view = { group, checkbox, count, entries: [] }; uiGroups.push(view);
      const syncToggle = () => { toggle.textContent = entries.hidden ? '展开' : '收起'; toggle.setAttribute('aria-expanded', String(!entries.hidden)); }; syncToggle(); toggle.setAttribute('aria-controls', entries.id);
      toggle.addEventListener('click', () => { entries.hidden = !entries.hidden; syncToggle(); });
      checkbox.addEventListener('change', () => { for (const record of group.records) { if (checkbox.checked) selected.add(record.id); else selected.delete(record.id); } update(); });
      for (const record of group.records) {
        const row = make('label', '', 'ai-annotation-choice'), input = make('input'); input.type = 'checkbox'; input.className = 'ai-annotation-checkbox'; input.dataset.recordId = record.id; input.setAttribute('aria-label', '选择标注：' + record.anchor.exact.slice(0, 80));
        const body = make('span', '', 'ai-choice-body'), quote = make('span', record.anchor.exact, 'ai-choice-quote');
        const meta = make('span', '', 'ai-choice-meta'), color = snapshot.palette.colors[record.color], dot = make('span', '', 'ai-color-dot'); dot.style.backgroundColor = color.hex;
        meta.append(dot, make('span', color.name));
        if (record.label) meta.append(make('span', '标签：' + record.label));
        body.append(quote, meta, make('span', record.note || '无批注', 'ai-choice-note')); row.append(input, body); entries.append(row);
        input.addEventListener('change', () => { if (input.checked) selected.add(record.id); else selected.delete(record.id); update(); });
        view.entries.push({ record, checkbox: input });
      }
      section.append(header, address, entries); list.append(section);
    }
    update();
  }
  $('ai-close').addEventListener('click', () => $('ai-export-dialog').close());
  $('ai-all').addEventListener('click', () => { selected = new Set(groups.flatMap(group => group.records.map(record => record.id))); update(); });
  $('ai-none').addEventListener('click', () => { selected.clear(); update(); });
  $('ai-task').addEventListener('input', update);
  $('ai-download').addEventListener('click', () => {
    if (!preview) return;
    const blob = new Blob([preview.markdown], { type: 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob), link = make('a');
    link.href = url; link.download = `墨迹-AI阅读材料-${exportedAt.replace(/[:.]/g, '-')}.md`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('ai-export-status').textContent = '已发起 Markdown 下载，可将下载的 .md 文件提供给 AI。';
  });
  window.MojiAiExport = {
    open(data, { pageKey = null } = {}) {
      snapshot = { records: structuredClone(data.records), palette: structuredClone(data.palette) };
      groups = MojiMarkdown.groupRecords(snapshot.records);
      groups.sort((a, b) => Number(b.url === pageKey) - Number(a.url === pageKey));
      selected = new Set(groups.filter(group => group.url === pageKey).flatMap(group => group.records.map(record => record.id)));
      exportedAt = new Date().toISOString(); $('ai-task').value = defaultTask; $('ai-export-status').textContent = '';
      render(pageKey); $('ai-export-dialog').showModal(); $('ai-close').focus();
    }
  };
})();
