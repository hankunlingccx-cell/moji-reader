const { test } = require('node:test');
const assert = require('node:assert/strict');
const Palette = require('../extension/palette.js');
test('five stable slots expose short meanings and safe pale highlight fills', () => {
  const defaults = Palette.defaults(), colors = Palette.display(defaults);
  assert.equal(Palette.KEYS.length, 5); assert.equal(colors.yellow.name, '结论');
  assert.match(colors.green.fill, /^#[0-9a-f]{6}$/);
  defaults.colors.green.hex = '#ff9f43'; assert.equal(Palette.display(defaults).green.fill, '#ffd7b0');
  assert.equal(Palette.defaults().colors.green.hex, '#81bea0');
});
test('palette validation rejects missing slots, empty or long meanings, and invalid colors', () => {
  const cases = [v => { delete v.colors.blue; }, v => { v.colors.blue.name = ' '; }, v => { v.colors.blue.name = 'a'.repeat(13); }, v => { v.colors.blue.hex = '#fff'; }];
  for (const change of cases) { const value = Palette.defaults(); change(value); assert.throws(() => Palette.validate(value)); }
});
