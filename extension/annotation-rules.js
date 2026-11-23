(function (root) {
  'use strict';
  const length = value => [...value].length;
  function mode(task = '', requested = 'auto') {
    if (requested === 'phrase') return 'phrase';
    if (/(?:不要|不必|不只|不限于)(?:只)?(?:标注?|标记|选择|找)?\s*(?:名词|关键词|短语)/i.test(task)) return 'sentence';
    return /名词|因素(?:的)?名称|(?:只|仅).{0,4}(?:词语|词组)|关键词|关键短语|\b(?:nouns?|noun phrases?|keywords?|terms?)\b/i.test(task) ? 'phrase' : 'sentence';
  }
  function firstOnly(task = '') { return /(?:首次|第一次|第一处).{0,4}出现|(?:只|仅).{0,6}(?:标注?|标记).{0,6}(?:一次|一处)|(?:只|仅).{0,6}(?:首次|第一次|第一处)|first\s+occurrence/i.test(task); }
  function noteError(note) {
    if (typeof note !== 'string' || !note.trim()) return '每条 AI 标注必须填写批注，说明为何选择及原文依据（不超过80字）。';
    if (length(note) > 80) return 'AI 批注超过80字，请精简后重试；未截断或写入。';
    return null;
  }
  function phraseError(value) {
    if (typeof value !== 'string' || !value.trim()) return '名词模式必须提供原文 phrase，不接受整句或整段回退。';
    const text = value.trim();
    if (/[。！？!?；;\n\r]|[.]$/.test(text) || length(text) > (/\p{Script=Han}/u.test(text) ? 40 : 120) || (!/\p{Script=Han}/u.test(text) && text.split(/\s+/).length > 10)) return '范围不像短语：请选择一个简短名词或名词短语，不能提交完整句子或段落。';
    return null;
  }
  function occurrences(text, phrase) {
    const found = [];
    for (let p = text.indexOf(phrase); p !== -1; p = text.indexOf(phrase, p + 1)) {
      if (/[A-Za-z0-9_]/.test(phrase[0]) && /[A-Za-z0-9_]/.test(text[p - 1] || '')) continue;
      if (/[A-Za-z0-9_]/.test(phrase.at(-1)) && /[A-Za-z0-9_]/.test(text[p + phrase.length] || '')) continue;
      found.push(p);
    }
    return found;
  }
  const api = { mode, firstOnly, noteError, phraseError, occurrences, length };
  root.MojiAnnotationRules = api; if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
