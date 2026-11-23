(function (root) {
  'use strict';
  let sequence = 0;
  const installed = new WeakSet();
  const css = `.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.info-wrap{position:relative;display:inline-flex;align-items:center;vertical-align:middle;flex-shrink:0}.info-button{display:inline-flex!important;align-items:center;justify-content:center;width:26px;height:26px;padding:4px!important;border:0!important;border-radius:50%;background:transparent!important;color:#8e8e93!important;cursor:pointer;font:inherit}.info-button:hover{background:#f2f2f7!important;color:#48484a!important}.info-button:focus-visible{outline:2px solid #007aff;outline-offset:2px}.info-button svg{width:16px;height:16px;flex-shrink:0}.info-tip{position:absolute;right:0;top:calc(100% + 6px);z-index:20;width:230px;max-width:calc(100vw - 48px);padding:10px 12px;border:1px solid #e5e5ea;border-radius:10px;background:rgba(255,255,255,.98);box-shadow:0 5px 24px #00000014;color:#48484a;font:12px/1.65 -apple-system,system-ui,sans-serif!important;font-weight:400!important;text-align:left;white-space:normal;pointer-events:none;visibility:hidden;opacity:0}.info-wrap:hover>.info-tip,.info-wrap:focus-within>.info-tip,.info-wrap[data-open]>.info-tip{visibility:visible;opacity:1}.info-wrap[data-dismissed]>.info-tip{visibility:hidden;opacity:0}`;
  function create(doc, label, message) {
    const wrap = doc.createElement('span'); wrap.className = 'info-wrap';
    const button = doc.createElement('button'), tip = doc.createElement('span');
    button.type = 'button'; button.className = 'info-button'; button.setAttribute('aria-label', label);
    tip.id = 'moji-info-' + (++sequence); tip.className = 'info-tip'; tip.setAttribute('role', 'tooltip'); tip.textContent = message;
    button.setAttribute('aria-describedby', tip.id);
    function position() {
      const boundary = wrap.closest('#drawer')?.getBoundingClientRect(), view = doc.defaultView;
      const left = (boundary?.left || 0) + 8, right = (boundary?.right || view.innerWidth) - 8;
      tip.style.maxWidth = Math.max(120, right - left) + 'px'; tip.style.left = ''; tip.style.right = '0';
      if (wrap.getBoundingClientRect().right - tip.offsetWidth < left) { tip.style.left = '0'; tip.style.right = 'auto'; }
    }
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>';
    button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); position(); if (wrap.hasAttribute('data-open')) { wrap.removeAttribute('data-open'); wrap.setAttribute('data-dismissed', ''); } else { wrap.removeAttribute('data-dismissed'); wrap.setAttribute('data-open', ''); } });
    button.addEventListener('focus', () => { position(); wrap.removeAttribute('data-dismissed'); });
    button.addEventListener('blur', () => { wrap.removeAttribute('data-open'); wrap.removeAttribute('data-dismissed'); });
    wrap.addEventListener('pointerenter', () => { position(); wrap.removeAttribute('data-dismissed'); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { wrap.removeAttribute('data-open'); wrap.setAttribute('data-dismissed', ''); e.stopPropagation(); } });
    wrap.append(button, tip); return wrap;
  }
  function install(target) {
    const doc = target.ownerDocument || target;
    if (!installed.has(target)) {
      const style = doc.createElement('style'); style.textContent = css; (target.head || target).append(style); installed.add(target);
      target.addEventListener('pointerdown', e => { for (const wrap of target.querySelectorAll('.info-wrap[data-open]')) if (!e.composedPath().includes(wrap)) { wrap.removeAttribute('data-open'); wrap.setAttribute('data-dismissed', ''); } });
    }
    for (const slot of target.querySelectorAll('[data-info]')) { const info = create(doc, slot.getAttribute('aria-label') || '更多信息', slot.dataset.info); slot.replaceWith(info); }
  }
  root.MojiInfo = { create, install };
})(globalThis);
