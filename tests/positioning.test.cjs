const { test } = require('node:test');
const assert = require('node:assert/strict');
const { floating } = require('../extension/positioning.js');
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const options = { width: 280, height: 62, viewportWidth: 1200, viewportHeight: 800 };
function clear(p, r, size = options) { return p.y + size.height <= r.top || p.y >= r.bottom || p.x + size.width <= r.left || p.x >= r.right; }
test('uses actual line bounds and panel height instead of a cursor offset', () => {
  const r = rect(40, 200, 1000, 244), p = floating({ ...options, rects: [r], point: { x: 430, y: 243 } });
  assert.equal(p.placement, 'above'); assert.equal(p.y + options.height, r.top - 12); assert.ok(clear(p, r));
});
test('near the viewport top the panel moves below the annotated line', () => {
  const r = rect(20, 9, 1100, 48), p = floating({ ...options, rects: [r], point: { x: 250, y: 44 } });
  assert.equal(p.placement, 'below'); assert.equal(p.y, 60); assert.ok(clear(p, r));
});
test('multi-line annotations do not place the menu on a preceding highlighted line', () => {
  const rects = [rect(480, 180, 1000, 205), rect(40, 220, 600, 245)];
  const p = floating({ ...options, rects, point: { x: 200, y: 242 } });
  assert.equal(p.placement, 'above'); assert.ok(rects.every(r => clear(p, r)));
});
test('near the bottom the panel remains above the visible text and inside the viewport', () => {
  const r = rect(900, 750, 1195, 795), p = floating({ ...options, rects: [r], point: { x: 1190, y: 790 } });
  assert.ok(p.x + options.width <= 1192); assert.ok(p.y >= 8); assert.ok(clear(p, r));
});
test('tall annotations can use free space beside their text', () => {
  const r = rect(30, 5, 480, 798), p = floating({ ...options, rects: [r], point: { x: 350, y: 350 } });
  assert.equal(p.placement, 'right'); assert.ok(clear(p, r));
});
test('oversized viewport-filling selections choose a bounded fallback', () => {
  const r = rect(0, 0, 1200, 800), p = floating({ ...options, rects: [r], point: { x: 1000, y: 790 } });
  assert.ok(p.x >= 8 && p.x + options.width <= 1192); assert.ok(p.y >= 8 && p.y + options.height <= 792);
});
