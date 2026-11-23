/* Shared by the isolated content script and deterministic recovery tests. */
(function (root) {
  'use strict';
  const SKIP = 'script,style,noscript,textarea,input,select,option,button,svg,canvas,[contenteditable]:not([contenteditable="false"]),[data-moji-ui]';
  const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TD|TH|TR|UL)$/;
  function normalize(s) { return s.normalize('NFKC').replace(/\u00ad/g, '').replace(/\s+/gu, ' ').trim(); }
  function pageKey(url) {
    const u = new URL(url); u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    u.searchParams.sort(); return u.href;
  }
  function blockOf(node) {
    let el = node.parentElement;
    while (el && !BLOCK.test(el.tagName)) el = el.parentElement;
    return el;
  }
  function buildIndex(doc) {
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, 4);
    const segments = [], pieces = []; let size = 0, previousBlock = null, endsSpace = true;
    const hidden = new WeakMap();
    function isHidden(el) {
      if (!el) return false;
      if (hidden.has(el)) return hidden.get(el);
      const style = doc.defaultView?.getComputedStyle(el);
      const value = el.matches(SKIP) || el.hidden || style?.display === 'none' || style?.visibility === 'hidden' || isHidden(el.parentElement);
      hidden.set(el, value); return value;
    }
    for (let node; (node = walker.nextNode());) {
      if (isHidden(node.parentElement)) continue;
      const block = blockOf(node), chars = [], starts = [], ends = [];
      if (previousBlock && block !== previousBlock && !endsSpace) { chars.push(' '); starts.push(0); ends.push(0); endsSpace = true; }
      const raw = node.data;
      for (let i = 0; i < raw.length;) {
        const cp = String.fromCodePoint(raw.codePointAt(i)), next = i + cp.length;
        for (const ch of cp.normalize('NFKC')) {
          if (ch === '\u00ad') continue;
          const space = /\s/u.test(ch);
          if (space && endsSpace) continue;
          // Range offsets use UTF-16, including compatibility expansions and emoji.
          for (let j = 0; j < (space ? ' ' : ch).length; j++) { chars.push((space ? ' ' : ch)[j]); starts.push(i); ends.push(next); }
          endsSpace = space;
        }
        i = next;
      }
      if (chars.length) {
        const text = chars.join(''); segments.push({ node, start: size, end: size + text.length, starts, ends });
        pieces.push(text); size += text.length;
      }
      previousBlock = block;
    }
    return { text: pieces.join(''), segments, doc };
  }
  function rangeAt(index, start, end) {
    if (start < 0 || end <= start || end > index.text.length) return null;
    const a = index.segments.find(s => s.end > start), b = index.segments.find(s => s.end >= end);
    if (!a || !b) return null;
    const range = index.doc.createRange();
    range.setStart(a.node, a.starts[start - a.start]); range.setEnd(b.node, b.ends[end - b.start - 1]);
    return range;
  }
  function capture(index, range) {
    const intersecting = index.segments.filter(s => range.intersectsNode(s.node));
    let start = Infinity, end = -1;
    for (const s of intersecting) {
      const lo = range.startContainer === s.node ? range.startOffset : 0;
      const hi = range.endContainer === s.node ? range.endOffset : s.node.length;
      for (let i = 0; i < s.starts.length; i++) {
        if (s.ends[i] > lo && s.starts[i] < hi) { start = Math.min(start, s.start + i); end = Math.max(end, s.start + i + 1); }
      }
    }
    while (start < end && index.text[start] === ' ') start++;
    while (end > start && index.text[end - 1] === ' ') end--;
    if (!Number.isFinite(start) || end <= start) throw new Error('请选择可标注的正文文字。');
    const exact = index.text.slice(start, end);
    if (exact.length > 20000) throw new Error('单条标注最多 20,000 字，请分段标记。');
    let exactCount = 0; for (let p = index.text.indexOf(exact); p !== -1; p = index.text.indexOf(exact, p + 1)) exactCount++;
    return { exact, prefix: index.text.slice(Math.max(0, start - 80), start), suffix: index.text.slice(end, end + 80), start, end, exactCount, version: 1 };
  }
  function commonLeft(a, b) { let n = 0; while (n < Math.min(a.length, b.length) && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; }
  function commonRight(a, b) { let n = 0; while (n < Math.min(a.length, b.length) && a[n] === b[n]) n++; return n; }
  function scoreContext(text, start, end, anchor) {
    const l = commonLeft(anchor.prefix, text.slice(Math.max(0, start - anchor.prefix.length), start));
    const r = commonRight(anchor.suffix, text.slice(end, end + anchor.suffix.length));
    return { l, r, score: l + r };
  }
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = Array(b.length + 1).fill(max + 1); cur[0] = i;
      for (let j = Math.max(1, i - max); j <= Math.min(b.length, i + max); j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function locate(index, anchor) {
    const { text } = index, { exact } = anchor;
    const candidates = [];
    for (let p = text.indexOf(exact); p !== -1; p = text.indexOf(exact, p + 1)) {
      candidates.push({ start: p, end: p + exact.length, ...scoreContext(text, p, p + exact.length, anchor) });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length === 1) {
      const c = candidates[0];
      // Long unique quotes survive layout/context changes; short quotes need surrounding evidence.
      if ((anchor.exactCount || 1) > 1 && c.score < 20) return { status: 'unanchored', reason: '原文曾有多个相同片段，剩余文字缺少上下文依据。' };
      if (exact.length >= 20 || c.score >= Math.min(12, anchor.prefix.length + anchor.suffix.length)) return { ...c, status: 'exact' };
    }
    if (candidates.length > 1) {
      const [a, b] = candidates;
      if (a.score >= 20 && a.score - b.score >= 12) return { ...a, status: 'context' };
      return { status: 'unanchored', reason: '出现多处相同文字，无法可靠区分。' };
    }
    // Only accept small edits bracketed by two unique, unchanged context strings.
    // Never choose a fuzzy match purely because it is near the old offset.
    if (!candidates.length && exact.length >= 30 && exact.length <= 2000 && anchor.prefix.length >= 20 && anchor.suffix.length >= 20) {
      const left = anchor.prefix.slice(-32), right = anchor.suffix.slice(0, 32), edits = [];
      for (let p = text.indexOf(left); p !== -1; p = text.indexOf(left, p + 1)) {
        const start = p + left.length;
        const limit = Math.min(8, Math.floor(exact.length * 0.06));
        const from = Math.max(start, start + exact.length - limit), to = start + exact.length + limit;
        for (let end = text.indexOf(right, from); end !== -1 && end <= to; end = text.indexOf(right, end + 1)) {
          if (distance(exact, text.slice(start, end), limit) <= limit) edits.push({ start, end, status: 'adjusted' });
        }
      }
      if (edits.length === 1) return edits[0];
    }
    return { status: 'unanchored', reason: '原文尚未加载、已修改，或没有足够的定位依据。' };
  }
  const api = { normalize, pageKey, buildIndex, capture, rangeAt, locate, distance };
  root.MojiAnchor = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
