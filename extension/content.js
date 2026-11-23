(() => {
  'use strict';
  if (globalThis.__mojiLoaded || !document.body) return;
  globalThis.__mojiLoaded = true;
  const A = MojiAnchor;
  const bilingual = MojiBilingual.tracker;
  const learned = new Map();
  const unsavedInputs = new Map(); let contextInvalid = false, taskPanel;
  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  let palette = MojiPalette.defaults(), colors = MojiPalette.display(palette), lastColor = 'yellow';
  let page = A.pageKey(location.href), records = [], drafts = {}, attached = new Map();
  let pending = null, editor = null, relinkId = null, bindLanguage = false, hidden = false, filter = 'all', search = '';
  let busy = false, stopped = false, refreshTimer, saveDraftChain = Promise.resolve(), undo = [], redo = [], panelId = null;
  const icons = {
    highlight: '<path d="m15 3 6 6-9 9H6v-6z"/><path d="m13 5 6 6M6 18l-3 3h6M3 22h18"/>',
    underline: '<path d="M6 3v8a6 6 0 0 0 12 0V3M4 21h16"/>',
    bold: '<path d="M6 3h7a4.5 4.5 0 0 1 0 9H6zm0 9h8a4.5 4.5 0 0 1 0 9H6z"/>',
    note: '<path d="M21 11v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h7"/><path d="m17 3 4 4-9 9-5 1 1-5zM15 5l4 4"/>',
    delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
  };
  const iconSvg = name => `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const host = document.createElement('div'); host.dataset.mojiUi = ''; host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483646!important;font:14px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif!important;color:#1c1c1e!important;color-scheme:light!important;';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host{all:initial;color-scheme:light;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#263b38}
    *{box-sizing:border-box}button,input,textarea,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:wait}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #247b70;outline-offset:3px}
    button{border:0;background:none;color:inherit} [hidden]{display:none!important}
    #launcher{position:fixed;right:22px;bottom:24px;display:flex;align-items:center;gap:9px;padding:11px 17px;border:1px solid #d7e2dc;border-radius:30px;background:#fffef9;box-shadow:0 5px 24px #163b3822;font-weight:650;color:#28665c}
    .logo{font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#28665c}.muted{color:#7a8783;font-size:12px}.eyebrow{color:#72867e;font-size:10px;letter-spacing:2px;font-weight:700}
    #drawer{position:fixed;right:16px;top:16px;bottom:16px;width:374px;max-width:calc(100vw - 32px);background:#fffef9;border:1px solid #dce4de;border-radius:18px;box-shadow:0 12px 60px #12342d30;display:flex;flex-direction:column;overflow:hidden}
    header{padding:20px 22px 13px;border-bottom:1px solid #e9ece4} .row{display:flex;align-items:center;gap:8px}.between{justify-content:space-between}h1{font-size:19px;margin:0;font-weight:650}h2{font-size:15px;margin:0 0 12px}.icon{border-radius:8px;padding:4px 9px;font-size:18px}.icon:hover,.quiet:hover{background:#edf2eb}
    #page-title{font-size:12px;color:#75837a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:9px}#page-source{display:inline-block;font-size:11px;color:#397562;text-decoration:none;margin-top:3px}#page-source:hover{text-decoration:underline}#status{font-size:11px;color:#497267;min-height:20px;margin-top:6px}#status.error{color:#b4483e}
    .tools{padding:12px 20px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid #eceee7}.quiet{padding:5px 8px;border-radius:6px;font-size:12px}.search{width:100%;margin-top:5px;background:#f4f5ef;border:1px solid #e4e7dd;border-radius:8px;padding:8px 10px;color:#33443c}.filter{flex:1;background:#fffef9;border:1px solid #e0e5dc;border-radius:7px;padding:5px;font-size:12px}
    #list{flex:1;overflow:auto;padding:6px 20px 16px} .card{padding:15px 0;border-bottom:1px solid #e9ece4}.card-top{display:flex;align-items:center;gap:7px;font-size:11px;color:#7b877f;margin-bottom:7px}.dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}.badge{font-size:10px;color:#9c6c2c;background:#fff0d5;border-radius:4px;padding:1px 5px}.quote{display:block;text-align:left;width:100%;font-family:Georgia,"Microsoft YaHei",serif;font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;padding:0}.quote:hover{color:#226b60}.note{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;color:#66766d;margin-top:8px;max-height:80px;overflow:auto}.label{font-size:11px;background:#edf2eb;color:#46715e;border-radius:4px;padding:1px 6px}.actions{display:flex;gap:4px;margin-top:8px;align-items:center}.actions button{font-size:11px;padding:3px 6px;border-radius:5px;color:#587364}.actions button:hover{background:#edf2eb}.actions .danger{color:#a76159}.empty{padding:40px 8px;text-align:center;color:#78867c;font-size:13px;line-height:2}.empty .empty-icon{font-size:32px;color:#9eafa0;margin-bottom:12px}
    footer{padding:12px 20px;border-top:1px solid #e9ece4;background:#f8f9f3;display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#7e8a7f}footer button{color:#397562;font-weight:600}
    #editor{flex:1;overflow:auto;padding:20px}#editor blockquote{margin:0 0 16px;padding:10px 13px;border-left:3px solid #d5bd6b;background:#f5f4e9;font-size:13px;max-height:140px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}label.field{display:block;font-size:12px;font-weight:600;margin:13px 0 5px}#editor input,#editor textarea{width:100%;background:white;border:1px solid #d9e0d6;border-radius:8px;padding:10px;color:#31443a}#editor textarea{resize:vertical;min-height:145px;line-height:1.8}.primary{background:#286b5c;color:white;padding:9px 16px;border-radius:8px;font-size:12px}.secondary{padding:8px 12px;border:1px solid #d9e0d6;border-radius:8px;font-size:12px}.style-toggle{padding:6px 12px;border:1px solid #dfe4da;border-radius:6px;font-size:12px}.style-toggle[aria-pressed="true"]{background:#e5efe6;border-color:#91b79c;color:#215c46}.swatch{width:26px;height:26px;border:3px solid #fffef9;border-radius:50%;outline:1px solid transparent}.swatch[aria-pressed="true"]{outline-color:#365b4a}.editor-controls{display:flex;gap:8px;flex-wrap:wrap}.help{font-size:11px;color:#8c8977;margin:12px 0}#draft-state{font-size:11px;margin-top:8px;color:#738470}
    #toolbar{position:fixed;display:flex;align-items:center;gap:3px;max-width:calc(100vw - 16px);padding:5px 7px;background:#fffef9;border:1px solid #d8e1d7;border-radius:12px;box-shadow:0 6px 26px #18382d25;z-index:3}#toolbar button{padding:6px 10px;border-radius:7px;font-size:12px;white-space:nowrap}#toolbar button:hover{background:#edf2e7}#toolbar .hl{background:#faedb9}#toolbar .sep{width:1px;height:20px;background:#e0e5da}
    #toolbar button[data-add],.action-icon{width:38px;height:36px;display:inline-flex;align-items:center;justify-content:center;padding:7px!important;border-radius:7px}.action-icon:hover{background:#edf2e7}.action-icon[aria-pressed="true"]{background:#e0eddf;color:#256149}.action-icon[aria-pressed="true"]:after{content:"";position:absolute;bottom:3px;width:4px;height:3px;border-radius:2px;background:currentColor}#mark-panel{position:fixed;display:flex;align-items:center;gap:4px;padding:6px;background:#fffef9;border:1px solid #d8e1d7;border-radius:12px;box-shadow:0 6px 26px #18382d25;z-index:4}#mark-panel button{position:relative}#mark-panel .divider{height:22px;width:1px;background:#e0e5da;margin:0 3px}#mark-panel .dismiss{width:26px;height:32px;border-radius:6px;font-size:18px;color:#829080}#mark-panel .dismiss:hover{background:#edf2e7}
    #mark-panel{max-width:calc(100vw - 16px)}#mark-panel .danger-icon{color:#a85b52}#mark-panel .danger-icon:hover{background:#f8e9e5;color:#9c3f36}
    #tooltip{position:fixed;max-width:300px;background:rgba(255,254,249,.76);backdrop-filter:blur(14px) saturate(135%);-webkit-backdrop-filter:blur(14px) saturate(135%);color:#294238;border:1px solid rgba(255,255,255,.8);border-radius:10px;padding:10px 13px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;box-shadow:0 5px 22px #18392c1a,0 0 0 1px #3a614514;pointer-events:none;z-index:4}#toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);max-width:80vw;background:#264e40;color:#fffef9;border-radius:10px;padding:10px 18px;font-size:12px;box-shadow:0 5px 20px #0002;z-index:5}
    #toolbar{gap:4px;padding:7px 8px;max-width:calc(100vw - 16px)}#selection-colors{display:flex;gap:2px;min-width:0}#selection-colors .color-choice{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:45px;min-width:29px;padding:4px 1px;border-radius:7px}#selection-colors .color-choice:hover{background:#edf2e7}#selection-colors .color-dot{width:20px;height:20px;border-radius:50%;box-shadow:inset 0 0 0 1px #00000012;flex-shrink:0}#selection-colors .color-name{font-size:10px;line-height:14px;max-width:43px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#596d5f}#toolbar button[data-add]{width:30px;height:34px;padding:5px!important;flex-shrink:0}#palette-settings-button{font-size:17px;width:27px;min-width:27px;padding:3px!important}#toolbar .sep{flex-shrink:0;margin:0 2px}#toolbar.relink-mode #selection-colors,#toolbar.relink-mode #palette-settings-button,#toolbar.relink-mode .sep{display:none}#toolbar.relink-mode{width:auto}
    #radial{position:fixed;width:236px;padding:7px 8px 5px;z-index:6;background:#fffef9f5;border:1px solid #dfe5db;border-radius:12px;box-shadow:0 6px 28px #1f3e352b;backdrop-filter:blur(8px);touch-action:none}#color-hint{height:22px;font-size:11px;line-height:22px;text-align:center;color:#7a887a;white-space:nowrap;pointer-events:none}#radial.ready #color-hint{color:#235f46;font-weight:650}#color-strip{display:flex;justify-content:space-between;gap:2px}#color-strip button{width:42px;height:38px;display:flex;align-items:center;justify-content:center;padding:0;border-radius:8px;position:relative;touch-action:none}#color-strip .color-dot{width:23px;height:23px;border-radius:50%;box-shadow:inset 0 0 0 1px #00000014;pointer-events:none;transition:transform .12s ease,box-shadow .12s ease}#color-strip button.active .color-dot{transform:scale(1.35);box-shadow:0 0 0 2px #fffef9,0 0 0 3px #49705b}#color-strip button[aria-checked="true"]:after{content:"";position:absolute;bottom:0;width:4px;height:3px;border-radius:2px;background:#547a60}#color-strip button:focus-visible{outline-offset:0}@media(prefers-reduced-motion:reduce){#color-strip .color-dot{transition:none}}@media(max-width:420px){#selection-colors .color-choice{width:36px}#selection-colors .color-name{max-width:34px}#toolbar{gap:2px;padding:5px}}
    @media(prefers-reduced-motion:no-preference){#drawer{animation:enter .18s ease-out}@keyframes enter{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}}
    /* iOS-inspired white surfaces. Annotation colors remain user-controlled. */
    :host{color:#1c1c1e;-webkit-font-smoothing:antialiased}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline-color:#007aff90}
    #launcher{background:rgba(255,255,255,.9);backdrop-filter:blur(20px);border-color:#e5e5ea;color:#007aff;box-shadow:0 4px 22px #0000000c}.logo{font-family:inherit;font-size:20px;font-weight:650;color:#007aff}.muted,.eyebrow{color:#8e8e93}.eyebrow{font-size:9px;letter-spacing:1.3px}
    #drawer{background:rgba(255,255,255,.96);backdrop-filter:blur(24px);border-color:#e5e5ea;border-radius:20px;box-shadow:0 12px 55px #0000001a}header{border-color:#e5e5ea}h1{font-size:20px;letter-spacing:-.4px;color:#1c1c1e}.icon{color:#8e8e93}.icon:hover,.quiet:hover{background:#f2f2f7}#page-title{color:#8e8e93}#page-source{color:#007aff}#status{color:#8e8e93}#status.error{color:#d93025}
    .tools{border-color:#e5e5ea}.quiet{color:#636366}.search{background:#f2f2f7;border-color:transparent;border-radius:10px;color:#1c1c1e}.filter{background:#f5f5f7;border-color:transparent;color:#636366;border-radius:9px}.card{border-color:#ededf1}.card-top{color:#8e8e93}.quote{font-family:inherit;color:#2c2c2e;line-height:1.8}.quote:hover{color:#007aff}.note{color:#636366}.label{background:#f0f0f5;color:#636366;border-radius:5px}.actions button{color:#007aff}.actions button:hover{background:#eff5ff}.actions .danger{color:#ff3b30}.empty{color:#8e8e93}.empty .empty-icon{color:#c7c7cc}
    footer{background:#fafafa;border-color:#e5e5ea;color:#8e8e93}footer button{color:#007aff;font-weight:550}#editor blockquote{background:#f5f5f7;border-color:#d1d1d6;color:#48484a}label.field{color:#636366;font-weight:550}#editor input,#editor textarea{background:#fff;border-color:#e5e5ea;border-radius:10px;color:#1c1c1e}.primary{background:#007aff;border-radius:10px}.secondary{background:#f5f5f7;border-color:#e5e5ea;border-radius:10px;color:#636366}.help,#draft-state{color:#8e8e93}
    #toolbar,#mark-panel,#radial{background:rgba(255,255,255,.9);backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%);border-color:#00000012;box-shadow:0 6px 28px #00000012;border-radius:14px;color:#3a3a3c}#toolbar button:hover,.action-icon:hover,#selection-colors .color-choice:hover,#mark-panel .dismiss:hover{background:#f2f2f7}.action-icon[aria-pressed="true"]{background:#eaf3ff;color:#007aff}#mark-panel .divider,#toolbar .sep{background:#e5e5ea}#mark-panel .dismiss{color:#8e8e93}#mark-panel .danger-icon{color:#ff3b30}#mark-panel .danger-icon:hover{background:#fff0ef;color:#ff3b30}#selection-colors .color-name{color:#8e8e93}#toolbar #palette-settings-button{color:#8e8e93;font-size:17px}
    #tooltip{background:rgba(255,255,255,.8);backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%);color:#3a3a3c;border-color:#ffffffdb;box-shadow:0 5px 24px #00000012,0 0 0 1px #00000008;border-radius:12px}#toast{background:rgba(255,255,255,.94);backdrop-filter:blur(18px);color:#1c1c1e;border:1px solid #e5e5ea;box-shadow:0 5px 24px #00000014;border-radius:12px}
    #color-hint{color:#8e8e93}#radial.ready #color-hint{color:#3a3a3c}#color-strip button.active .color-dot{box-shadow:0 0 0 2px #fff,0 0 0 3px #007aff}#color-strip button[aria-checked="true"]:after{background:#8e8e93}
    *{scrollbar-width:thin;scrollbar-color:#c7c7cc transparent}
    #context-warning{padding:9px;background:#fff5e7;border:1px solid #f1dcc0;border-radius:9px;margin-top:8px;font-size:11px;color:#805b25;line-height:1.7}#context-warning button{background:white;border:1px solid #e5d4ba;border-radius:6px;margin:5px 5px 0 0;padding:4px 7px;font-size:11px}
    header{padding:14px 20px 12px}header h1{font-size:17px;font-weight:600;letter-spacing:0}.header-actions{display:flex;align-items:center;gap:2px}#page-source{display:flex;align-items:center;gap:5px;margin:7px 0 0;min-width:0;color:#636366;text-decoration:none}#page-source:hover{color:#007aff}#page-title{margin:0;min-width:0;font-size:12px;color:inherit}#page-source svg{width:13px;height:13px;flex-shrink:0}#status{min-height:0;margin-top:6px;font-size:11px;color:#636366}footer{padding:7px 20px;justify-content:flex-end}footer #library{min-height:28px}.actions{flex-wrap:wrap;column-gap:6px}#draft-state:empty{display:none}.field-row{display:flex;align-items:center;gap:3px;margin:13px 0 5px}.field-row>label.field{margin:0}
  </style>
  <button id="launcher" title="打开墨迹标注侧栏"><span class="logo">墨</span><span>阅读标注</span><span id="launcher-count" class="muted">0</span></button>
  <section id="drawer" hidden aria-label="墨迹阅读标注侧栏">
    <header><div class="row between"><h1>标注</h1><div class="header-actions"><span data-info="标注保存在此浏览器。卸载扩展、删除配置或重装可能丢失数据；请在标注库导出备份。" aria-label="数据与备份说明"></span><button id="close" class="icon" title="关闭侧栏" aria-label="关闭标注侧栏">×</button></div></div><a id="page-source" target="_blank" rel="noopener noreferrer"><span id="page-title"></span><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M5 3H3v10h10v-2M8 3h5v5M7 9l6-6"/></svg></a><div id="status" role="status" aria-live="polite">正在读取本地标注…</div><div id="context-warning" role="alert" hidden>扩展已更新。未保存的输入仍保留在面板中，请先下载输入副本再刷新。<div><button id="context-download" type="button">下载输入副本</button><button id="context-refresh" type="button">刷新此页</button></div></div></header>
    <details id="codex-task-panel"></details>
    <div id="tools" class="tools"><button id="undo" class="quiet" title="撤销上次标注修改">↶ 撤销</button><button id="redo" class="quiet">↷ 重做</button><button id="hide" class="quiet">隐藏标记</button><button id="retry" class="quiet">重新匹配</button><select id="filter" class="filter" aria-label="筛选标注"><option value="all">全部标注</option><option value="unanchored">待重新定位</option><option value="notes">含笔记</option><option value="drafts">有草稿</option><option value="deleted">回收站</option><option value="yellow">黄色 · 重要结论</option><option value="blue">蓝色 · 研究方法</option><option value="green">绿色 · 值得借鉴</option><option value="rose">红色 · 疑问待查</option><option value="purple">紫色 · 其他想法</option></select><input id="search" class="search" placeholder="搜索原文、标签或笔记…" aria-label="搜索当前论文标注"></div>
    <div id="list"></div><div id="editor" hidden></div><footer><button id="library">标注库与备份 ↗</button></footer>
  </section>
  <div id="toolbar" hidden role="toolbar" aria-label="文字标注"><div id="selection-colors" aria-label="选择高亮颜色与含义"></div><span class="sep"></span><button data-add="underline"><u>下划线</u></button><button data-add="bold"><b>加粗</b></button><button data-add="note">笔记 / 标签</button><button id="palette-settings-button" title="自定义颜色与含义" aria-label="自定义颜色与含义">⚙</button><button id="relink-selection" hidden>将原记录定位到此处</button></div>
  <div id="mark-panel" hidden role="toolbar" aria-label="编辑已有标注"><button class="action-icon" data-format="underline" title="下划线" aria-label="下划线">${iconSvg('underline')}</button><button class="action-icon" data-format="highlight" title="高亮" aria-label="高亮">${iconSvg('highlight')}</button><button class="action-icon" data-format="bold" title="加粗" aria-label="加粗">${iconSvg('bold')}</button><span class="divider"></span><button class="action-icon" id="panel-note" title="记录笔记" aria-label="记录笔记">${iconSvg('note')}</button><button class="action-icon danger-icon" id="panel-delete" title="删除标注（可在回收站恢复）" aria-label="删除标注">${iconSvg('delete')}</button><button class="dismiss" id="panel-close" title="关闭标注面板" aria-label="关闭标注面板">×</button></div>
  <div id="tooltip" hidden role="tooltip"></div><div id="toast" hidden role="status"></div><div id="radial" hidden role="menu" aria-label="横向换色菜单"><div id="color-hint" aria-live="polite">移入颜色 · 松开取消</div><div id="color-strip"></div></div>`;
  document.documentElement.append(host);
  const $ = id => ui.getElementById(id);
  const text = (tag, content, className) => { const el = document.createElement(tag); el.textContent = content; if (className) el.className = className; return el; };
  const btn = (label, fn, className) => { const b = text('button', label, className); b.addEventListener('click', fn); return b; };
  function applyPalette(value) {
    palette = MojiPalette.validate(value); colors = MojiPalette.display(palette);
    $('selection-colors').replaceChildren();
    for (const [key, color] of Object.entries(colors)) {
      const b = btn('', () => { lastColor = key; add('highlight', key); }, 'color-choice');
      b.dataset.colorAdd = key; b.title = `高亮 · ${color.name}`; b.setAttribute('aria-label', `高亮 · ${color.name}`);
      const dot = text('span', '', 'color-dot'); dot.style.background = color.hex; dot.setAttribute('aria-hidden', 'true');
      b.append(dot, text('span', color.name, 'color-name')); $('selection-colors').append(b);
      const option = $('filter').querySelector(`option[value="${key}"]`); if (option) option.textContent = color.name;
    }
  }
  async function rpc(type, fields = {}) {
    try {
      if (contextInvalid) throw new Error('Extension context invalidated.');
      const result = await chrome.runtime.sendMessage({ type: 'moji:' + type, ...fields });
      if (!result?.ok) throw new Error(result?.error || '插件连接中断。请保留输入内容，刷新网页后重试。'); return result.value;
    } catch (error) { const info = MojiRuntimeErrors.describe(error); if (info.invalidated) invalidateContext(); throw new Error(info.message); }
  }
  function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
  let toastTimer;
  function toast(message, error = false) { $('toast').textContent = message; $('toast').hidden = false; $('toast').style.background = 'rgba(255,255,255,.94)'; $('toast').style.color = error ? '#d93025' : '#1c1c1e'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 3300); }
  function fail(error) { const info = MojiRuntimeErrors.describe(error); if (info.invalidated) invalidateContext(); if (!contextInvalid) { status(info.message, true); toast(info.message, true); } }
  function invalidateContext() {
    if (contextInvalid) return; contextInvalid = true; observer.disconnect(); clearTimeout(refreshTimer); taskPanel?.invalidate();
    $('context-warning').hidden = false; $('status').hidden = true;
    for (const b of ui.querySelectorAll('button')) if (!['context-download', 'context-refresh', 'close', 'launcher'].includes(b.id)) b.disabled = true;
  }
  function downloadRecovery() {
    const payload = { app: 'moji-unsaved-input', pageKey: page, at: new Date().toISOString(), notes: [...unsavedInputs.values()], taskPrompt: taskPanel?.prompt() || '' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })), a = document.createElement('a');
    a.href = url; a.download = '墨迹-未保存输入-' + Date.now() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function openDrawer() { $('drawer').hidden = false; $('launcher').hidden = true; if (!contextInvalid) taskPanel?.refresh(); }
  function closeDrawer() { $('drawer').hidden = true; $('launcher').hidden = false; }
  function current(id) { return records.find(r => r.id === id); }
  function updateStatus() {
    if (contextInvalid) return;
    const live = records.filter(r => !r.deleted), missing = live.filter(r => attached.get(r.id)?.status === 'unanchored').length;
    status(`${live.length} 条标注${missing ? ` · ${missing} 待定位` : ''}`);
    $('launcher-count').textContent = String(live.length); $('undo').disabled = !undo.length || busy; $('redo').disabled = !redo.length || busy;
  }
  const observer = new MutationObserver(mutations => {
    if (mutations.every(m => m.target === host || host.contains(m.target))) return;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { checkNavigation(); if (!busy) renderMarks(); }, 650);
  });
  function observe() { observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] }); }
  function unwrap() {
    const parents = new Set();
    for (const span of document.querySelectorAll('span[data-moji-mark]')) { parents.add(span.parentNode); span.replaceWith(...span.childNodes); }
    for (const parent of parents) parent.normalize();
  }
  function renderMarks() {
    if (stopped || contextInvalid) return;
    observer.disconnect();
    try {
      unwrap(); const index = bilingual.sync(A.buildIndex(document)); attached = new Map(); const ranges = [];
      for (const record of records) {
        if (record.deleted) continue;
        const found = bilingual.locate(index, record); attached.set(record.id, found);
        if (found.bilingual) {
          const value = MojiBilingual.merge(record.bilingual, found.bilingual), signature = JSON.stringify(value);
          if (learned.get(record.id) !== signature && JSON.stringify(record.bilingual) !== signature) {
            learned.set(record.id, signature);
            rpc('learnBilingual', { id: record.id, anchor: record.anchor, bilingual: value }).then(saved => { if (saved && current(record.id) === record) record.bilingual = saved; }).catch(error => { learned.delete(record.id); fail(error); });
          }
        }
        if (found.status !== 'unanchored') ranges.push({ ...found, record });
      }
      for (const segment of index.segments) {
        const hits = ranges.filter(r => r.start < segment.end && r.end > segment.start); if (!hits.length) continue;
        const spans = hits.map(r => {
          const start = Math.max(r.start, segment.start) - segment.start;
          const end = Math.min(r.end, segment.end) - segment.start;
          return { start: segment.starts[start], end: segment.ends[end - 1], record: r.record };
        }).filter(r => r.end > r.start);
        const cuts = [...new Set([0, segment.node.length, ...spans.flatMap(r => [r.start, r.end])])].sort((a, b) => a - b), fragment = document.createDocumentFragment();
        for (let i = 1; i < cuts.length; i++) {
          const start = cuts[i - 1], end = cuts[i], active = spans.filter(r => r.start < end && r.end > start).map(r => r.record).sort((a, b) => a.updatedAt - b.updatedAt);
          const value = segment.node.data.slice(start, end);
          if (!active.length || hidden) { fragment.append(document.createTextNode(value)); continue; }
          const span = document.createElement('span'); span.dataset.mojiMark = active.map(r => r.id).join(' '); span.textContent = value;
          const top = active.at(-1), highlighted = active.filter(r => r.styles.highlight).at(-1);
          span.style.setProperty('border-radius', '2px', 'important');
          if (highlighted) span.style.setProperty('background-color', colors[highlighted.color].fill, 'important');
          if (active.some(r => r.styles.bold)) span.style.setProperty('font-weight', '750', 'important');
          if (active.some(r => r.styles.underline)) { span.style.setProperty('text-decoration', 'underline', 'important'); span.style.setProperty('text-decoration-color', colors[top.color].hex, 'important'); span.style.setProperty('text-decoration-thickness', '2px', 'important'); span.style.setProperty('text-underline-offset', '3px', 'important'); }
          fragment.append(span);
        }
        segment.node.replaceWith(fragment);
      }
      updateStatus(); renderList();
    } catch (error) { fail(error); }
    finally { observe(); }
  }
  async function refresh() {
    if (contextInvalid) return;
    const forPage = page, result = await rpc('list', { pageKey: forPage });
    if (forPage !== page) return;
    records = result.records; drafts = result.drafts;
    if (JSON.stringify(result.palette) !== JSON.stringify(palette)) { applyPalette(result.palette); closeRadial(); }
    renderMarks();
  }
  function renderList() {
    $('page-title').textContent = document.title; const list = $('list'); list.replaceChildren();
    $('page-source').href = page; $('page-source').title = page;
    $('page-source').setAttribute('aria-label', '打开原文：' + document.title);
    const needle = search.toLocaleLowerCase();
    const shown = records.filter(r => {
      if (filter === 'deleted' ? !r.deleted : r.deleted) return false;
      if (filter === 'unanchored' && attached.get(r.id)?.status !== 'unanchored') return false;
      if (filter === 'notes' && !r.note) return false;
      if (filter === 'drafts' && !drafts[r.id]) return false;
      if (colors[filter] && r.color !== filter) return false;
      return !needle || [r.anchor.exact, r.note, r.label].some(v => v.toLocaleLowerCase().includes(needle));
    }).sort((a, b) => a.anchor.start - b.anchor.start || a.createdAt - b.createdAt);
    if (!shown.length) {
      const empty = text('div', '', 'empty'); empty.append(text('div', '〰', 'empty-icon'), text('div', filter === 'all' && !search ? '读到值得留下的地方，\n选中文字开始标注。' : '这里暂时没有标注。'), text('div', '高亮 · 下划线 · 加粗 · 笔记', 'muted')); list.append(empty);
    }
    for (const r of shown) {
      const card = text('article', '', 'card'); card.dataset.recordId = r.id;
      const top = text('div', '', 'card-top'), dot = text('span', '', 'dot'); dot.style.background = colors[r.color].hex;
      top.append(dot, text('span', colors[r.color].name));
      const found = attached.get(r.id);
      if (!r.deleted && found?.status === 'unanchored') top.append(text('span', '待重新定位', 'badge'));
      if (found?.status === 'adjusted') top.append(text('span', '原文有小幅修改', 'badge'));
      if (found?.scope === 'paragraph') top.append(text('span', '跨语言段落定位', 'badge'));
      if (/\btranslated-(?:ltr|rtl)\b/.test(document.documentElement.className) && MojiBilingual.language(r.anchor.exact) === 'zh' && !r.bilingual?.variants?.some(v => v.language === 'en')) {
        const hint = text('span', '尚未绑定英文', 'badge'); hint.title = '可显示一次原文以尝试建立对应，或点击“绑定另一语言”手动选择英文。'; top.append(hint);
      }
      if (drafts[r.id]) top.append(text('span', '有草稿', 'badge'));
      const quote = btn(r.anchor.exact, () => jump(r.id), 'quote'); card.append(top, quote);
      if (r.label) card.append(text('span', r.label, 'label'));
      if (r.note) card.append(text('div', r.note, 'note'));
      const actions = text('div', '', 'actions');
      if (!r.deleted) {
        const remove = btn('删除', () => change(r.id, { deleted: true }, 'delete'), 'danger'); remove.title = '移入回收站，笔记和历史保留'; remove.setAttribute('aria-description', remove.title);
        actions.append(btn('编辑', () => edit(r.id)), btn('重新定位', () => beginRelink(r.id)), btn('绑定另一语言', () => beginRelink(r.id, true)), remove);
      }
      else actions.append(btn('恢复记录', () => change(r.id, { deleted: false }, 'restore')));
      actions.append(btn('版本', () => showHistory(r.id))); card.append(actions); list.append(card);
    }
  }
  async function persist(patch, previous, kind = 'edit', track = true) {
    const id = previous?.id || uid(), operation = { id, baseRevision: previous?.revision || 0, patch, opId: uid(), kind };
    busy = true; status('正在保存…');
    try {
      let result;
      try { result = await rpc('mutate', operation); }
      catch (error) { if (!/连接|message port|Receiving end|closed/i.test(error.message)) throw error; result = await rpc('mutate', operation); }
      records = records.filter(r => r.id !== id); records.push(result);
      if (track) { undo.push({ id, before: previous ? structuredClone(previous) : { ...result, deleted: true }, after: structuredClone(result), expected: result.revision }); redo = []; }
      return result;
    } finally { busy = false; }
  }
  async function change(id, patch, kind = 'edit') {
    if (busy) return;
    try { const r = await persist(patch, current(id), kind); renderMarks(); toast(kind === 'delete' ? '已移入回收站，可撤销或恢复' : '已保存到本地'); return r; }
    catch (error) { fail(error); await refresh().catch(() => {}); }
  }
  async function travel(from, to, reverse) {
    if (busy || !from.length) return;
    const entry = from.at(-1), r = current(entry.id);
    if (r?.revision !== entry.expected) { toast('标注已发生其他修改，请通过“版本”查看和恢复。', true); return; }
    try {
      const result = await persist(reverse ? entry.before : entry.after, r, reverse ? 'undo' : 'redo', false);
      from.pop(); to.push({ ...entry, expected: result.revision });
      // An older operation for this record can become undoable again after the latest is undone.
      const prior = [...from].reverse().find(e => e.id === entry.id); if (prior) prior.expected = result.revision;
      renderMarks(); toast(reverse ? '已撤销' : '已重做');
    } catch (error) { fail(error); }
  }
  function place(element, x, y, width, height) { element.style.left = Math.max(8, Math.min(innerWidth - width - 8, x)) + 'px'; element.style.top = Math.max(8, Math.min(innerHeight - height - 8, y)) + 'px'; }
  function markRects(id) {
    return [...document.querySelectorAll(`span[data-moji-mark~="${id}"]`)].flatMap(span => [...span.getClientRects()]);
  }
  function placeByText(element, rects, point) {
    const result = MojiPosition.floating({ rects: [...rects], width: element.offsetWidth, height: element.offsetHeight, viewportWidth: innerWidth, viewportHeight: innerHeight, point });
    element.style.left = result.x + 'px'; element.style.top = result.y + 'px'; element.dataset.placement = result.placement;
  }
  function captureSelection() {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || host.contains(selection.anchorNode) || ui.contains(selection.anchorNode)) { if (!relinkId) $('toolbar').hidden = true; return; }
    const range = selection.getRangeAt(0);
    if (range.commonAncestorContainer.parentElement?.closest('input,textarea,[contenteditable="true"]')) return;
    try {
      const index = bilingual.sync(A.buildIndex(document)), anchor = A.capture(index, range);
      pending = { anchor, bilingual: bilingual.capture(index, anchor) }; $('toolbar').hidden = false;
      $('toolbar').classList.toggle('relink-mode', !!relinkId);
      for (const b of ui.querySelectorAll('[data-add]')) b.hidden = !!relinkId;
      $('relink-selection').hidden = !relinkId;
      $('mark-panel').hidden = true;
      placeByText($('toolbar'), range.getClientRects());
    } catch { $('toolbar').hidden = true; }
  }
  async function add(style, color = lastColor) {
    if (!pending || busy) return;
    const anchor = structuredClone(pending.anchor);
    try {
      const record = await persist({ pageKey: page, title: document.title.slice(0, 1000), anchor, bilingual: pending.bilingual, originalQuote: anchor.exact, label: '', note: '', color, styles: { highlight: style === 'highlight' || style === 'note', underline: style === 'underline', bold: style === 'bold' }, deleted: false }, null, 'create');
      pending = null; $('toolbar').hidden = true; getSelection()?.removeAllRanges(); renderMarks(); toast('标注已保存'); if (style === 'note') edit(record.id);
    } catch (error) { fail(error); }
  }
  function jump(id) {
    const r = current(id), found = attached.get(id);
    if (r.deleted) return toast('这条记录在回收站中，请先恢复。');
    if (!found || found.status === 'unanchored') return toast(found?.reason || '暂时无法定位，可点击“重新定位”。', true);
    const el = document.querySelector(`span[data-moji-mark~="${id}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.animate([{ outline: '3px solid #286b5c' }, { outline: '3px solid transparent' }], { duration: 1600 }); }
    else { const index = A.buildIndex(document), range = A.rangeAt(index, found.start, found.end); range?.startContainer.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  function beginRelink(id, bind = false) {
    relinkId = id; bindLanguage = bind; pending = null; $('toolbar').hidden = true; closeDrawer();
    toast(bind ? '切换网页语言，选中对应句子，再点击“绑定此语言摘录”。原标注与笔记会保留。' : '重新选中网页中的对应文字，再点击“将原记录定位到此处”。Esc 取消。');
    $('relink-selection').textContent = bind ? '绑定此语言摘录' : '将原记录定位到此处';
  }
  async function relink() {
    if (!pending || !relinkId || busy) return;
    const r = current(relinkId), anchor = structuredClone(pending.anchor);
    const lang = MojiBilingual.language(anchor.exact);
    if (bindLanguage && lang === 'und') return toast('请选择完整的中文或英文句子，以便确认语言。', true);
    const binding = MojiBilingual.merge(r.bilingual, pending.bilingual, { variants: [{ language: lang, scope: 'selection', anchor }] });
    const result = await change(r.id, bindLanguage ? { bilingual: binding } : { anchor, bilingual: pending.bilingual, originalQuote: r.originalQuote || r.anchor.exact }, bindLanguage ? 'language-bind' : 'relink');
    if (result) { relinkId = null; pending = null; $('toolbar').hidden = true; getSelection()?.removeAllRanges(); openDrawer(); toast(bindLanguage ? '已绑定另一语言的精确摘录，原始摘录和笔记仍保留' : '已重新定位，原始摘录与历史版本仍保留'); }
  }
  function showMarkPanel(id, x, y) {
    const r = current(id); if (!r || r.deleted) return;
    closeEditor(); panelId = id; $('tooltip').hidden = true; $('toolbar').hidden = true;
    for (const b of ui.querySelectorAll('[data-format]')) b.setAttribute('aria-pressed', String(r.styles[b.dataset.format]));
    $('mark-panel').hidden = false; placeByText($('mark-panel'), markRects(id), { x, y });
  }
  function edit(id) {
    const r = current(id); if (!r) return;
    $('mark-panel').hidden = true;
    openDrawer(); editor = { id, baseRevision: r.revision, draftId: uid(), sequence: 0 };
    const target = editor;
    const saved = drafts[id], useDraft = saved && (saved.note !== r.note || saved.label !== r.label);
    $('editor').replaceChildren(); $('editor').hidden = false; $('tools').hidden = true; $('list').hidden = true;
    const pane = $('editor'); pane.append(text('h2', '编辑标注'), text('blockquote', r.anchor.exact));
    for (const v of r.bilingual?.variants || []) if (v.anchor.exact !== r.anchor.exact) pane.append(text('div', `${v.language === 'en' ? '英文原文' : '中文译文'} · ${v.scope === 'paragraph' ? '对应段落（非逐词对齐）' : '精确摘录'}`, 'muted'), text('blockquote', v.anchor.exact));
    const label = text('label', '标签', 'field'); label.htmlFor = 'note-label'; const labelInput = document.createElement('input'); labelInput.id = 'note-label'; labelInput.maxLength = 200; labelInput.value = useDraft ? saved.label : r.label;
    const noteLabel = text('label', '笔记', 'field'); noteLabel.htmlFor = 'note-body'; const noteInput = document.createElement('textarea'); noteInput.id = 'note-body'; noteInput.maxLength = 100000; noteInput.value = useDraft ? saved.note : r.note;
    const draftState = text('div', useDraft ? '已载入草稿' : ''); draftState.id = 'draft-state'; draftState.setAttribute('role', 'status');
    const noteHeading = text('div', '', 'field-row'); noteHeading.append(noteLabel, MojiInfo.create(document, '笔记保存说明', '输入后自动保存。发生版本冲突时，输入保留为独立草稿。'));
    function noteChanged() {
      const sequence = ++target.sequence, value = { label: labelInput.value, note: noteInput.value };
      unsavedInputs.set(id, { recordId: id, draftId: target.draftId, sequence, ...value });
      draftState.textContent = '正在自动保存…';
      const write = rpc('autosave', { id, draftId: target.draftId, baseRevision: target.baseRevision, sequence, ...value }).then(result => {
        if (result.conflict) {
          drafts[id] = result.draft;
          draftState.textContent = '其他窗口已修改此标注；你的输入已保留为独立草稿。';
          status('自动保存遇到版本冲突，草稿已保留。', true); return;
        }
        const local = current(id);
        if (!local || local.revision <= result.record.revision) { records = records.filter(r => r.id !== id); records.push(result.record); }
        if (editor === target && sequence === target.sequence) draftState.textContent = '已自动保存';
        if (unsavedInputs.get(id)?.draftId === target.draftId && unsavedInputs.get(id)?.sequence === sequence) unsavedInputs.delete(id);
        renderList(); updateStatus();
      }).catch(error => { draftState.textContent = '自动保存失败，请保留输入并继续编辑重试。'; fail(error); throw error; });
      saveDraftChain = Promise.all([saveDraftChain.catch(() => {}), write]).then(() => {});
      saveDraftChain.catch(() => {});
    }
    labelInput.addEventListener('input', noteChanged); noteInput.addEventListener('input', noteChanged);
    const controls = text('div', '', 'row'); controls.style.marginTop = '18px';
    controls.append(btn('完成', () => { closeEditor(); renderList(); }, 'secondary'));
    pane.append(label, labelInput, noteHeading, noteInput, draftState, controls);
    noteInput.focus();
  }
  function closeEditor() { editor = null; $('editor').hidden = true; $('tools').hidden = false; $('list').hidden = false; }
  async function showHistory(id) {
    try {
      const versions = await rpc('history', { id }); openDrawer(); closeEditor(); $('editor').hidden = false; $('tools').hidden = true; $('list').hidden = true;
      const pane = $('editor'); pane.replaceChildren(text('h2', '版本记录'), text('p', '恢复会创建一个新版本，已有记录继续保留。', 'muted'), btn('← 返回标注', () => { closeEditor(); renderList(); }, 'secondary'));
      for (const version of versions) {
        const r = version.record, card = text('div', '', 'card');
        card.append(text('div', `${new Date(version.at).toLocaleString()} · ${version.kind} · v${r.revision}`, 'muted'), text('div', r.anchor.exact.slice(0, 160), 'note'), text('div', r.label || '无标签', 'label'), text('div', r.note || '无笔记', 'note'));
        card.append(btn('恢复这个版本', async () => { const result = await change(id, { ...r, deleted: false }, 'version-restore'); if (result) { closeEditor(); renderList(); } }, 'quiet')); pane.append(card);
      }
    } catch (error) { fail(error); }
  }
  // Hover previews and pointer-based radial color menu work without taking over ordinary text selection.
  let press = null, radial = null, suppressClick = false;
  const markAt = target => target instanceof Element ? target.closest('span[data-moji-mark]') : null;
  function topRecord(mark) { return mark?.dataset.mojiMark.split(' ').map(current).filter(Boolean).at(-1); }
  function showTooltip(event) {
    const r = topRecord(markAt(event.target)); if (!r || radial) { $('tooltip').hidden = true; return; }
    $('tooltip').textContent = [r.label, r.note, !r.label && !r.note ? colors[r.color].name : '', '点击编辑 · 长按换色'].filter(Boolean).join('\n'); $('tooltip').hidden = false;
    place($('tooltip'), event.clientX + 14, event.clientY + 18, 300, Math.min(240, $('tooltip').offsetHeight));
    $('tooltip').style.maxHeight = '240px'; $('tooltip').style.overflow = 'hidden';
  }
  document.addEventListener('pointerover', showTooltip, true);
  document.addEventListener('pointerout', () => { $('tooltip').hidden = true; }, true);
  function showRadial(record, x, y, drag) {
    $('tooltip').hidden = true; $('toolbar').hidden = true; $('mark-panel').hidden = true; const element = $('radial'); element.hidden = false;
    $('color-strip').replaceChildren(); element.classList.remove('ready');
    $('color-hint').textContent = drag ? '移入颜色 · 松开取消' : '移入颜色查看含义';
    radial = { id: record.id, drag, selected: null, zones: [] };
    Object.entries(colors).forEach(([key, color]) => {
      const b = btn('', async () => { const id = radial?.id; closeRadial(); if (id) { lastColor = key; await change(id, { color: key }); } });
      b.dataset.color = key; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-label', color.name); b.setAttribute('aria-checked', String(record.color === key)); b.title = color.name;
      const dot = text('span', '', 'color-dot'); dot.style.background = color.hex; dot.setAttribute('aria-hidden', 'true'); b.append(dot);
      b.addEventListener('pointerenter', () => { if (radial && !radial.drag) setColorTarget(key); });
      b.addEventListener('focus', () => { if (radial) setColorTarget(key); });
      // A released long press can be followed by a new press-and-slide gesture.
      b.addEventListener('pointerdown', event => { if (radial && event.button === 0) { radial.drag = true; setColorTarget(key); event.preventDefault(); } });
      b.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault();
        const buttons = [...$('color-strip').children], next = (buttons.indexOf(b) + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length; buttons[next].focus();
      });
      $('color-strip').append(b);
    });
    placeByText(element, markRects(record.id), { x, y });
    radial.zones = [...$('color-strip').children].map(b => ({ key: b.dataset.color, rect: b.getBoundingClientRect() }));
  }
  function setColorTarget(key) {
    if (!radial) return; radial.selected = key;
    $('radial').classList.toggle('ready', !!key);
    $('color-hint').textContent = key ? colors[key].name : '移入颜色 · 松开取消';
    for (const b of $('color-strip').children) b.classList.toggle('active', b.dataset.color === key);
  }
  function closeRadial() { radial = null; $('radial').hidden = true; }
  $('color-strip').addEventListener('pointerleave', () => { if (radial && !radial.drag) setColorTarget(null); });
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    if (!event.composedPath().includes(host)) { if (radial) closeRadial(); $('mark-panel').hidden = true; }
    const mark = markAt(event.target), r = topRecord(mark); if (!r) return;
    clearTimeout(press?.timer);
    const value = { id: r.id, x: event.clientX, y: event.clientY, timer: null };
    value.timer = setTimeout(() => { suppressClick = true; showRadial(r, value.x, value.y, true); getSelection()?.removeAllRanges(); }, 450); press = value;
  }, true);
  document.addEventListener('pointermove', event => {
    if (radial?.drag) {
      const zone = radial.zones.find(({ rect }) => event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4);
      setColorTarget(zone?.key || null);
    } else if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 7) { clearTimeout(press.timer); press = null; }
  }, true);
  document.addEventListener('pointerup', event => {
    clearTimeout(press?.timer); press = null;
    if (radial?.drag) {
      const { id, selected } = radial;
      event.preventDefault(); getSelection()?.removeAllRanges();
      if (selected) { lastColor = selected; closeRadial(); change(id, { color: selected }); }
      else { radial.drag = false; setColorTarget(null); $('color-hint').textContent = '移入颜色查看含义 · Esc 取消'; }
      setTimeout(() => { suppressClick = false; }, 350); return;
    }
    if (!event.composedPath().includes(host)) requestAnimationFrame(captureSelection);
  }, true);
  document.addEventListener('pointercancel', () => { clearTimeout(press?.timer); press = null; closeRadial(); suppressClick = false; }, true);
  document.addEventListener('click', event => {
    if (suppressClick && !event.composedPath().includes(host)) { event.preventDefault(); event.stopPropagation(); return; }
    const r = topRecord(markAt(event.target));
    if (r && getSelection()?.isCollapsed && !event.ctrlKey && !event.metaKey) { event.preventDefault(); showMarkPanel(r.id, event.clientX, event.clientY); }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeRadial(); $('toolbar').hidden = true; $('mark-panel').hidden = true; $('tooltip').hidden = true; if (relinkId) toast('已取消重新定位'); relinkId = null; return; }
    if (event.composedPath().some(el => el instanceof Element && el.matches('input,textarea,[contenteditable="true"]'))) return;
    if (event.altKey && event.shiftKey) {
      const style = { h: 'highlight', u: 'underline', b: 'bold', n: 'note' }[event.key.toLowerCase()];
      if (style) { event.preventDefault(); captureSelection(); add(style); }
    }
  }, true);
  // Keep the document selection intact while clicking its floating toolbar.
  $('toolbar').addEventListener('pointerdown', e => e.preventDefault());
  for (const b of ui.querySelectorAll('[data-add]')) {
    const style = b.dataset.add, label = { highlight: '高亮', underline: '下划线', bold: '加粗', note: '记录笔记' }[style];
    b.innerHTML = iconSvg(style); b.title = label; b.setAttribute('aria-label', label);
    b.addEventListener('click', () => add(style));
  }
  for (const b of ui.querySelectorAll('[data-format]')) b.addEventListener('click', async () => {
    if (busy) return;
    const id = panelId, buttons = [...$('mark-panel').querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    try {
      await saveDraftChain.catch(() => {});
      const r = current(id); if (!r) return;
      await change(id, { styles: { ...r.styles, [b.dataset.format]: !r.styles[b.dataset.format] } }, 'style');
      const updated = current(id);
      if (updated && panelId === id) for (const item of ui.querySelectorAll('[data-format]')) item.setAttribute('aria-pressed', String(updated.styles[item.dataset.format]));
    } finally { buttons.forEach(button => { button.disabled = false; }); }
  });
  $('panel-note').addEventListener('click', () => edit(panelId));
  $('panel-close').addEventListener('click', () => { $('mark-panel').hidden = true; });
  $('panel-delete').addEventListener('click', async () => {
    if (busy) return;
    const id = panelId, button = $('panel-delete'); button.disabled = true;
    try {
      await saveDraftChain.catch(() => {});
      if (current(id)?.deleted === false && await change(id, { deleted: true }, 'delete')) { $('mark-panel').hidden = true; $('tooltip').hidden = true; }
    } finally { button.disabled = false; }
  });
  $('palette-settings-button').addEventListener('click', () => rpc('library', { palette: true }).catch(fail));
  $('relink-selection').addEventListener('click', relink);
  $('launcher').addEventListener('click', () => { openDrawer(); refresh().catch(fail); }); $('close').addEventListener('click', closeDrawer);
  $('library').addEventListener('click', () => rpc('library').catch(fail));
  $('filter').addEventListener('change', e => { filter = e.target.value; renderList(); }); $('search').addEventListener('input', e => { search = e.target.value; renderList(); });
  $('hide').addEventListener('click', () => { hidden = !hidden; $('hide').textContent = hidden ? '显示标记' : '隐藏标记'; renderMarks(); });
  $('retry').addEventListener('click', () => refresh().catch(fail)); $('undo').addEventListener('click', () => travel(undo, redo, true)); $('redo').addEventListener('click', () => travel(redo, undo, false));
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (['moji:documentInfo', 'moji:readDocument', 'moji:prepareAiHighlights'].includes(message.type)) {
      try {
        const url = A.pageKey(location.href);
        if (!['http:', 'https:', 'file:'].includes(new URL(url).protocol)) throw new Error('此页面不支持正文读取。');
        const info = { url, title: document.title.slice(0, 1000) };
        if (message.type === 'moji:documentInfo') { respond({ ok: true, value: info }); return; }
        const index = bilingual.sync(A.buildIndex(document));
        if (index.text.length > 1500000) throw new Error('正文过长，请打开文章章节的 HTML 页面后操作。');
        if (message.type === 'moji:readDocument') respond({ ok: true, value: { ...info, text: index.text, structure: MojiArticle.extract(index) } });
        else {
          if (index.text !== message.expectedText) throw new Error('页面在定位前发生变化，请重新读取正文。');
          const prepared = MojiAiAnchors.prepare(index.text, message.passages, message.colors);
          for (const item of prepared.items) { const pair = bilingual.capture(index, item.anchor); if (pair) item.bilingual = pair; }
          respond({ ok: true, value: prepared });
        }
      } catch (error) { respond({ ok: false, error: error.message }); }
      return;
    }
    if (message.type === 'moji:toggle') { if ($('drawer').hidden) { openDrawer(); refresh().catch(fail); } else closeDrawer(); }
    if (message.type === 'moji:changed' && !busy) refresh().catch(fail);
  });
  function checkNavigation() {
    if (contextInvalid) return;
    const next = A.pageKey(location.href);
    if (next !== page) {
      page = next; records = []; attached.clear(); pending = null; relinkId = null; undo = []; redo = []; closeEditor(); $('toolbar').hidden = true; $('mark-panel').hidden = true; closeRadial(); refresh().catch(fail);
    }
  }
  // SPAs may change the URL without a DOM mutation or popstate.
  setInterval(checkNavigation, 1500);
  window.addEventListener('popstate', checkNavigation);
  window.addEventListener('focus', () => { checkNavigation(); if (!busy) refresh().catch(fail); });
  window.addEventListener('scroll', () => { $('toolbar').hidden = true; $('mark-panel').hidden = true; $('tooltip').hidden = true; }, { passive: true });
  window.addEventListener('pagehide', () => { stopped = true; observer.disconnect(); });
  window.addEventListener('pageshow', () => { stopped = false; refresh().catch(fail); });
  MojiInfo.install(ui);
  taskPanel = MojiTaskPanel.mount({ ui, rpc, uid, isInvalid: () => contextInvalid });
  $('context-download').addEventListener('click', downloadRecovery);
  $('context-refresh').addEventListener('click', () => { if (unsavedInputs.size || taskPanel.prompt().trim()) downloadRecovery(); location.reload(); });
  applyPalette(palette); observe(); refresh().catch(fail);
})();
