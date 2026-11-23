(function (root) {
  'use strict';
  function floating({ rects, width, height, viewportWidth, viewportHeight, point, gap = 12, margin = 8 }) {
    const clamp = (n, min, max) => Math.max(min, Math.min(Math.max(min, max), n));
    const visible = rects.filter(r => r.right > 0 && r.bottom > 0 && r.left < viewportWidth && r.top < viewportHeight && r.right > r.left && r.bottom > r.top);
    const targets = visible.length ? visible : [{ left: point?.x || margin, right: (point?.x || margin) + 1, top: point?.y || margin, bottom: (point?.y || margin) + 1 }];
    const top = Math.max(0, Math.min(...targets.map(r => r.top))), bottom = Math.min(viewportHeight, Math.max(...targets.map(r => r.bottom)));
    const left = Math.max(0, Math.min(...targets.map(r => r.left))), right = Math.min(viewportWidth, Math.max(...targets.map(r => r.right)));
    const x = clamp(point ? point.x - width / 2 : targets[0].left, margin, viewportWidth - width - margin);
    const y = clamp((point?.y ?? (top + bottom) / 2) - height / 2, margin, viewportHeight - height - margin);
    const candidates = [
      { x, y: top - height - gap, placement: 'above' },
      { x, y: bottom + gap, placement: 'below' },
      { x: right + gap, y, placement: 'right' },
      { x: left - width - gap, y, placement: 'left' }
    ];
    const fits = p => p.x >= margin && p.y >= margin && p.x + width <= viewportWidth - margin && p.y + height <= viewportHeight - margin;
    const overlap = p => targets.reduce((area, r) => area + Math.max(0, Math.min(p.x + width, r.right + 3) - Math.max(p.x, r.left - 3)) * Math.max(0, Math.min(p.y + height, r.bottom + 3) - Math.max(p.y, r.top - 3)), 0);
    const clear = candidates.find(p => fits(p) && overlap(p) === 0);
    if (clear) return clear;
    // Extremely large selections may occupy the viewport. Keep the panel visible
    // and choose the candidate that covers the least selected/annotated text.
    return candidates.map(p => ({ ...p, x: clamp(p.x, margin, viewportWidth - width - margin), y: clamp(p.y, margin, viewportHeight - height - margin) })).sort((a, b) => overlap(a) - overlap(b))[0];
  }
  root.MojiPosition = { floating };
  if (typeof module !== 'undefined') module.exports = root.MojiPosition;
})(globalThis);
