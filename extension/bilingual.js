/* Observe real in-place translation. Never manufacture a translation or align by paragraph number. */
(function (root) {
  'use strict';
  const A = root.MojiAnchor || (typeof require === 'function' ? require('./anchor.js') : null);
  const BLOCK = /^(P|LI|H[1-6]|BLOCKQUOTE|FIGCAPTION|TD|TH|PRE|DIV|SECTION|ARTICLE|MAIN)$/;
  function language(value) {
    const zh = (value.match(/\p{Script=Han}/gu) || []).length, en = (value.match(/[A-Za-z]/g) || []).length;
    return zh >= 3 && zh * 2 >= en ? 'zh' : en >= 12 && en > zh * 4 ? 'en' : 'und';
  }
  function merge(...values) {
    const variants = [];
    for (const value of values) for (const v of value?.variants || []) {
      if (!variants.some(x => x.language === v.language && x.scope === v.scope && x.anchor.exact === v.anchor.exact && x.anchor.prefix === v.anchor.prefix && x.anchor.suffix === v.anchor.suffix)) variants.push(v);
    }
    return { version: 1, variants: variants.slice(-8) };
  }
  function units(index) {
    const groups = new Map();
    for (const segment of index.segments) {
      let el = segment.node.parentElement;
      while (el && !BLOCK.test(el.tagName)) el = el.parentElement;
      if (!el) continue;
      if (!groups.has(el)) groups.set(el, { el, start: segment.start, end: segment.end, contiguous: true });
      else { const group = groups.get(el); if (group.end !== segment.start) group.contiguous = false; group.end = segment.end; }
    }
    return [...groups.values()].filter(u => u.contiguous && u.end - u.start <= 20000).map(u => {
      while (index.text[u.start] === ' ') u.start++;
      while (index.text[u.end - 1] === ' ') u.end--;
      if (u.end <= u.start) return null;
      const exact = index.text.slice(u.start, u.end), first = index.text.indexOf(exact);
      const anchor = { exact, prefix: index.text.slice(Math.max(0, u.start - 80), u.start), suffix: index.text.slice(u.end, u.end + 80), start: u.start, end: u.end, exactCount: index.text.indexOf(exact, first + 1) < 0 ? 1 : 2, version: 1 };
      return { ...u, anchor, language: language(anchor.exact) };
    }).filter(Boolean);
  }
  function create(doc) {
    let history = new WeakMap(), current = [], page = doc.location?.href, sawTranslation = false;
    function sync(index = A.buildIndex(doc)) {
      if (doc.location?.href !== page) { history = new WeakMap(); page = doc.location?.href; sawTranslation = false; }
      sawTranslation ||= /\btranslated-(?:ltr|rtl)\b/.test(doc.documentElement.className);
      current = units(index);
      for (const u of current) {
        let versions = history.get(u.el) || [];
        // Google may translate a paragraph in several font-wrapped fragments.
        // Retain its pre-translation source until that in-place translation settles.
        const last = versions.at(-1);
        if (last && last.language === u.language && last.anchor.exact !== u.anchor.exact) {
          const translating = /\btranslated-(?:ltr|rtl)\b/.test(doc.documentElement.className) && u.el.querySelector('font');
          if (translating && u.language === 'en' && !versions.some(v => v.language === 'zh')) continue;
          if (translating) versions.pop();
          else versions = []; // Ordinary same-language edits invalidate the old association.
        }
        if (!last || last.anchor.exact !== u.anchor.exact) versions.push({ language: u.language, anchor: u.anchor });
        else versions[versions.length - 1] = { language: u.language, anchor: u.anchor };
        history.set(u.el, versions.slice(-4));
      }
      return index;
    }
    function pairFor(u) {
      const versions = history.get(u.el) || [];
      if (!sawTranslation || !['en', 'zh'].includes(u.language) || !versions.some(v => v.language === 'en') || !versions.some(v => v.language === 'zh')) return null;
      return { version: 1, variants: versions.filter(v => ['en', 'zh'].includes(v.language)).map(v => ({ ...v, scope: 'paragraph' })) };
    }
    function capture(index, anchor) {
      const unit = current.find(u => u.start <= anchor.start && u.end >= anchor.end);
      const pair = unit && pairFor(unit);
      return pair ? merge(pair, { variants: [{ language: unit.language, scope: 'selection', anchor }] }) : null;
    }
    function locate(index, record) {
      const direct = A.locate(index, record.anchor);
      if (direct.status !== 'unanchored') return { ...direct, scope: 'selection', bilingual: capture(index, { ...record.anchor, start: direct.start, end: direct.end }) };
      const alternatives = [...(record.bilingual?.variants || [])].sort((a, b) => (a.scope === 'paragraph') - (b.scope === 'paragraph'));
      for (const v of alternatives) {
        const found = A.locate(index, v.anchor);
        if (found.status !== 'unanchored') return { ...found, language: v.language, scope: v.scope, bilingual: capture(index, { ...v.anchor, start: found.start, end: found.end }) };
      }
      // Match a saved quote against the observed pre-translation paragraph, then
      // use ONLY that very same live DOM element's translation. No offset fallback.
      const candidates = [];
      for (const unit of current) {
        const pair = pairFor(unit); if (!pair) continue;
        const matched = pair.variants.some(v => [record.anchor, ...alternatives.map(a => a.anchor)].some(a => {
          const found = A.locate({ text: v.anchor.exact }, a);
          return found.status !== 'unanchored';
        }));
        if (matched) candidates.push({ unit, pair });
      }
      if (candidates.length === 1) {
        const { unit, pair } = candidates[0];
        return { start: unit.start, end: unit.end, status: 'bilingual', scope: 'paragraph', language: unit.language, bilingual: pair };
      }
      return { status: 'unanchored', reason: candidates.length ? '有多个可能的双语段落，请手动绑定另一语言。' : '未找到可靠的原文或译文；记录已保留，可手动绑定另一语言或重新定位。' };
    }
    return { sync, capture, locate };
  }
  const api = { create, language, merge, units };
  root.MojiBilingual = api;
  if (typeof module !== 'undefined') module.exports = api;
  else if (root.document) {
    const tracker = api.create(root.document); api.tracker = tracker;
    let timer;
    const seed = () => { if (document.body) tracker.sync(); };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(seed, 120); });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'lang'] });
    document.addEventListener('DOMContentLoaded', seed, { once: true }); seed();
    window.addEventListener('pagehide', () => { clearTimeout(timer); observer.disconnect(); });
    window.addEventListener('pageshow', () => { observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'lang'] }); seed(); });
  }
})(globalThis);
