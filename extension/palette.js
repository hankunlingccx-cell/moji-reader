(function (root) {
  'use strict';
  const KEYS = ['yellow', 'blue', 'green', 'rose', 'purple'];
  const DEFAULTS = {
    yellow: { name: '结论', hex: '#f3cf63' }, blue: { name: '方法', hex: '#7eb4e2' },
    green: { name: '借鉴', hex: '#81bea0' }, rose: { name: '疑问', hex: '#e79d9d' }, purple: { name: '想法', hex: '#b7a0dd' }
  };
  function defaults() { return { revision: 0, colors: JSON.parse(JSON.stringify(DEFAULTS)) }; }
  function validate(value) {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.colors || Object.keys(value.colors).length !== KEYS.length) throw new Error('颜色设置格式无效。');
    const colors = {};
    for (const key of KEYS) {
      const color = value.colors[key];
      if (!color || typeof color.name !== 'string' || !color.name.trim() || color.name.trim().length > 12 || !/^#[0-9a-f]{6}$/i.test(color.hex)) throw new Error('请选择有效颜色，并填写 1–12 字的简短含义。');
      colors[key] = { name: color.name.trim(), hex: color.hex.toLowerCase() };
    }
    return { revision: value.revision, colors };
  }
  function display(value) {
    const valid = validate(value), result = {};
    for (const key of KEYS) {
      const color = valid.colors[key];
      const fill = '#' + [1, 3, 5].map(i => Math.round(parseInt(color.hex.slice(i, i + 2), 16) * 0.42 + 255 * 0.58).toString(16).padStart(2, '0')).join('');
      result[key] = { ...color, fill };
    }
    return result;
  }
  root.MojiPalette = { KEYS, defaults, validate, display };
  if (typeof module !== 'undefined') module.exports = root.MojiPalette;
})(globalThis);
