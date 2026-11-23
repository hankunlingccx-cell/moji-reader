(function (root) {
  'use strict';
  const A = root.MojiAnchor || (typeof require === 'function' ? require('./anchor.js') : null);
  const Rules = root.MojiAnnotationRules || (typeof require === 'function' ? require('./annotation-rules.js') : null);
  function prepare(text, passages, colorKeys, { selectionMode = 'sentence' } = {}) {
    if (!Array.isArray(passages) || !passages.length || passages.length > 200) throw new Error('每批需要 1–200 条原文摘录。');
    const items = [], rejected = [];
    passages.forEach((passage, index) => {
      try {
        if (!passage || typeof passage.quote !== 'string') throw new Error('需要原文 quote。');
        const exact = A.normalize(passage.quote);
        if (!exact || exact.length > 20000) throw new Error('每条原文需要 1–20,000 字。');
        const label = passage.label ?? 'Codex 自动标注', note = passage.note ?? '', color = passage.color ?? 'yellow';
        if (typeof label !== 'string' || label.length > 200 || !colorKeys.includes(color)) throw new Error('颜色或标签格式无效。');
        const noteError = Rules.noteError(note); if (noteError) throw new Error(noteError);
        const rangeMode = selectionMode === 'phrase' || passage.selectionMode === 'phrase' ? 'phrase' : 'sentence';
        if (rangeMode === 'phrase') { const error = Rules.phraseError(exact); if (error) throw new Error(error); }
        if ((passage.prefix !== undefined && typeof passage.prefix !== 'string') || (passage.suffix !== undefined && typeof passage.suffix !== 'string')) throw new Error('上下文必须为文字。');
        const prefix = A.normalize(passage.prefix || '').slice(-80), suffix = A.normalize(passage.suffix || '').slice(0, 80);
        const occurrences = [];
        for (let p = text.indexOf(exact); p !== -1; p = text.indexOf(exact, p + 1)) occurrences.push(p);
        const matched = occurrences.filter(start => (passage.start === undefined || passage.start === start) && (!prefix || A.normalize(text.slice(Math.max(0, start - 160), start)).endsWith(prefix)) && (!suffix || A.normalize(text.slice(start + exact.length, start + exact.length + 160)).startsWith(suffix)));
        if (matched.length === 0) throw new Error('原文不存在或上下文不匹配；未创建标注。');
        if (matched.length > 1) throw new Error('原文出现多次，请提供 prefix / suffix 或明确 start 位置。');
        const start = matched[0], end = start + exact.length;
        items.push({ index, label, note, color, selectionMode: rangeMode, anchor: { exact, prefix: text.slice(Math.max(0, start - 80), start), suffix: text.slice(end, end + 80), start, end, exactCount: occurrences.length, version: 1 } });
      } catch (error) { rejected.push({ index, quote: typeof passage?.quote === 'string' ? passage.quote.slice(0, 160) : '', reason: error.message }); }
    });
    return { items, rejected };
  }
  root.MojiAiAnchors = { prepare };
  if (typeof module !== 'undefined') module.exports = root.MojiAiAnchors;
})(globalThis);
