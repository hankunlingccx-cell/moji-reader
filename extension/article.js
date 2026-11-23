/* Local extraction and numbered references. Coordinates always refer to the full anchor index. */
(function (root) {
  'use strict';
  const BLOCK = /^(P|LI|H[1-6]|BLOCKQUOTE|FIGCAPTION|TD|TH|PRE|DIV|SECTION|ARTICLE|MAIN)$/;
  const NOISE = /(?:^|[\s_-])(?:cookie|consent|advertisement|advert|ads|social|share|sharing|breadcrumb|toolbar|navigation|related-articles|recommendations|newsletter)(?:$|[\s_-])/i;
  function excluded(el, container) {
    for (let p = el; p; p = p.parentElement) {
      if (p.matches('nav,footer,[role="navigation"],[role="banner"],[role="contentinfo"],[data-moji-ui]')) return true;
      if (p.matches('header,aside') && (container === container.ownerDocument.body || !p.closest('article,main,[role="main"]'))) return true;
      if (NOISE.test((p.id || '') + ' ' + (typeof p.className === 'string' ? p.className : ''))) return true;
      if (p === container) break;
    }
    return false;
  }
  function splitSentences(text) {
    const segments = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)].map(v => ({ text: v.segment, start: v.index })) : [{ text, start: 0 }];
    return segments.map(v => {
      const leading = v.text.length - v.text.trimStart().length, value = v.text.trim();
      return { text: value, start: v.start + leading, end: v.start + leading + value.length };
    }).filter(v => v.text);
  }
  function extract(index) {
    const doc = index.doc;
    const roots = [...doc.querySelectorAll('[itemprop="articleBody"],.article-body,.ltx_document,article,main,[role="main"]')].filter(el => !el.closest('nav,footer,[role="navigation"]'));
    // Prefer a semantic body with substantial text. Small semantic containers
    // such as a recommendation card must not replace an entire paper.
    const lengths = new Map();
    for (const el of roots) lengths.set(el, index.segments.filter(s => el.contains(s.node)).reduce((n, s) => n + s.end - s.start, 0));
    roots.sort((a, b) => lengths.get(b) - lengths.get(a));
    const container = roots.find(el => lengths.get(el) >= 120) || doc.body || doc.documentElement;
    const groups = [];
    for (const segment of index.segments) {
      if (!container.contains(segment.node) || excluded(segment.node.parentElement, container)) continue;
      let el = segment.node.parentElement; while (el && !BLOCK.test(el.tagName)) el = el.parentElement;
      if (!el) el = container;
      const last = groups.at(-1);
      if (last?.el === el && last.end === segment.start) last.end = segment.end;
      else groups.push({ el, start: segment.start, end: segment.end });
    }
    const sections = [], paragraphs = []; let section, referenceLevel = null;
    const newSection = (title, level, kind) => {
      section = { id: 's' + (sections.length + 1), title, level, kind, paragraphIds: [] }; sections.push(section);
    };
    for (const group of groups) {
      let start = group.start, end = group.end;
      while (index.text[start] === ' ') start++; while (index.text[end - 1] === ' ') end--;
      if (end <= start) continue;
      const text = index.text.slice(start, end);
      if (/^H[1-6]$/.test(group.el.tagName)) {
        const references = /^(?:[\dIVX.\s、]+)?(?:references|bibliography|literature cited)\b/i.test(text) || /^(?:[\d.\s、]+)?(?:参考文献|引用文献|参考资料|参考$)/.test(text), level = Number(group.el.tagName[1]);
        if (references) referenceLevel = level;
        else if (referenceLevel !== null && level <= referenceLevel) referenceLevel = null;
        newSection(text, level, referenceLevel !== null ? 'references' : 'body'); continue;
      }
      if (!section) newSection('正文开头', 0, 'body');
      // Keep giant blocks bounded and preserve exact offsets when splitting.
      const sentences = splitSentences(text); let chunk = [], chunkStart = 0;
      const flush = () => {
        if (!chunk.length) return;
        const finish = chunk.at(-1).end, value = text.slice(chunkStart, finish), id = 'p' + (paragraphs.length + 1);
        paragraphs.push({ id, sectionId: section.id, start: start + chunkStart, end: start + finish, text: value, sentences: chunk.map(s => ({ text: s.text, start: s.start - chunkStart, end: s.end - chunkStart })) });
        section.paragraphIds.push(id); chunk = [];
      };
      for (const s of sentences) {
        // A pathological unpunctuated block is split deterministically too.
        for (let lo = s.start; lo < s.end; lo += 6000) {
          const part = { start: lo, end: Math.min(s.end, lo + 6000), text: text.slice(lo, Math.min(s.end, lo + 6000)) };
          if (chunk.length && part.end - chunkStart > 6000) flush();
          if (!chunk.length) chunkStart = part.start;
          chunk.push(part);
        }
      }
      flush();
    }
    const cleanChars = paragraphs.reduce((n, p) => n + p.text.length, 0);
    return { version: 1, extraction: container === doc.body ? 'fallback' : 'semantic', rawChars: index.text.length, cleanChars, removedChars: Math.max(0, index.text.length - cleanChars), sections, paragraphs };
  }
  function outline(structure) {
    return structure.sections.map(s => ({ id: s.id, title: s.title, paragraphs: s.paragraphIds.length, kind: s.kind, defaultRead: s.kind !== 'references' }));
  }
  function read(structure, { sectionIds, offset = 0, maxChars = 12000 } = {}) {
    const wanted = sectionIds || structure.sections.filter(s => s.kind !== 'references').map(s => s.id);
    if (!Array.isArray(wanted) || !wanted.length || wanted.some(id => !structure.sections.some(s => s.id === id))) throw new Error('章节编号无效，请先查看章节目录。');
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(maxChars) || maxChars < 1000 || maxChars > 24000) throw new Error('分页参数无效。');
    const candidates = structure.paragraphs.filter(p => wanted.includes(p.sectionId));
    if (offset > candidates.length) throw new Error('段落游标超出所选章节范围。');
    const paragraphs = []; let size = 0, cursor = offset;
    while (cursor < candidates.length) {
      const p = candidates[cursor], value = { id: p.id, section: p.sectionId, sentences: p.sentences.map(s => s.text) }, cost = JSON.stringify(value).length;
      if (paragraphs.length && size + cost > maxChars) break;
      paragraphs.push(value); size += cost; cursor++;
    }
    return { sectionIds: wanted, paragraphOffset: offset, nextParagraphOffset: cursor < candidates.length ? cursor : null, totalParagraphs: candidates.length, paragraphs };
  }
  function resolve(structure, selections) {
    if (!Array.isArray(selections) || !selections.length || selections.length > 200) throw new Error('每批需要 1–200 条编号选择。');
    const passages = [], rejected = [];
    for (const [index, selection] of selections.entries()) {
      try {
        const p = structure.paragraphs.find(p => p.id === selection.paragraphId);
        if (!p) throw new Error('段落编号不存在。');
        let start = p.start, end = p.end;
        if (selection.sentenceNumbers !== undefined) {
          const nums = selection.sentenceNumbers;
          if (!Array.isArray(nums) || !nums.length || nums.some((n, i) => !Number.isInteger(n) || n < 1 || n > p.sentences.length || (i && n !== nums[i - 1] + 1))) throw new Error('句子编号需按顺序连续选择；不连续的句子请分成不同标注。');
          start += p.sentences[nums[0] - 1].start; end = p.start + p.sentences[nums.at(-1) - 1].end;
        }
        passages.push({ index, quote: p.text.slice(start - p.start, end - p.start), start, color: selection.color, label: selection.label, note: selection.note });
      } catch (error) { rejected.push({ index, paragraphId: selection?.paragraphId, reason: error.message }); }
    }
    return { passages, rejected };
  }
  const api = { extract, outline, read, resolve, splitSentences };
  root.MojiArticle = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
