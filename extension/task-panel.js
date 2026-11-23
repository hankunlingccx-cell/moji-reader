(function (root) {
  'use strict';
  function mount({ ui, rpc, uid, isInvalid }) {
    const panel = ui.getElementById('codex-task-panel');
    panel.innerHTML = `<style>
      #codex-task-panel{border-bottom:1px solid #e5e5ea;padding:10px 20px;flex-shrink:0;font-size:12px}#codex-task-panel summary{cursor:pointer;list-style:none;color:#007aff;font-weight:600;display:flex;align-items:center;justify-content:space-between}#codex-task-panel summary::-webkit-details-marker{display:none}#codex-task-panel summary span{font-size:10px;font-weight:400;color:#8e8e93}#task-content{padding-top:10px}#task-prompt{width:100%;box-sizing:border-box;min-height:62px;max-height:110px;resize:vertical;background:#f5f5f7;border:1px solid #e5e5ea;border-radius:10px;color:#1c1c1e;padding:9px;font:12px/1.6 -apple-system,system-ui,sans-serif}#task-presets{display:flex;gap:5px;margin:7px 0}#task-presets button{border-radius:12px;background:#f2f2f7;color:#636366;font-size:10px;padding:4px 8px}#task-actions{display:flex;gap:6px}#task-actions button{padding:6px 10px;border-radius:8px;font-size:11px;background:#f2f2f7;color:#007aff}#task-actions #task-start{background:#007aff;color:white}#task-actions button:disabled{opacity:.4;cursor:default}#task-status{line-height:1.7;color:#636366;margin-top:7px;overflow-wrap:anywhere}#task-status.error{color:#d93025}#task-stats{font-size:10px;color:#8e8e93;margin-top:3px}#task-history{width:100%;font-size:10px;border:0;color:#8e8e93;background:#fff;margin-top:6px}#task-execution-hint{font-size:10px;color:#8e8e93;line-height:1.5;margin:7px 0 0}#task-summary{font-size:11px;white-space:pre-wrap;max-height:65px;overflow:auto;color:#636366;margin-top:7px}
    </style><summary>交给 Codex <span id="task-caption">一句话批注当前文章</span></summary><div id="task-content"><textarea id="task-prompt" maxlength="2000" rows="2" aria-label="交给 Codex 的阅读任务" placeholder="例如：标出影响团队创意的因素"></textarea><div id="task-presets"><button type="button" data-preset="标出本文的研究方法，用中文简要说明用途。">研究方法</button><button type="button" data-preset="标出本文的主要发现，区分直接证据与作者推测。">主要发现</button><button type="button" data-preset="标出作者明确提到的研究局限，用中文简要说明。">研究局限</button></div><div id="task-actions"><button id="task-start" type="button">开始</button><button id="task-stop" type="button" disabled>停止</button><button id="task-undo" type="button" disabled>整批撤销</button></div><div id="task-status" role="status" aria-live="polite">输入任务后开始，使用本机 Codex 独立阅读会话。</div><div id="task-stats"></div><select id="task-history" aria-label="当前网页的最近阅读任务" hidden></select><div id="task-summary" hidden></div><p id="task-execution-hint">默认中文短批注，保留双语定位。停止后已写入标注保留，可整批撤销。任务使用你的 Codex 登录与额度。</p></div>`;
    const $ = id => ui.getElementById(id), active = status => ['starting', 'reading', 'writing', 'stopping'].includes(status);
    let selectedId = null, tasks = [], working = false, timer, stopped = false, requestId = null, lastPrompt = '';
    function render(task) {
      const running = task && active(task.status);
      $('task-start').disabled = working || running || isInvalid(); $('task-stop').disabled = working || !running || task?.status === 'stopping' || isInvalid();
      $('task-undo').disabled = working || !task || task.status === 'undone' || isInvalid(); $('task-prompt').disabled = running && !isInvalid();
      if (!task) return;
      $('task-caption').textContent = running ? '任务进行中' : task.status === 'completed' ? '已完成' : task.status === 'undone' ? '已撤销' : task.status === 'failed' ? '执行失败' : '已停止';
      $('task-status').textContent = task.message; $('task-status').className = task.status === 'failed' ? 'error' : '';
      $('task-stats').textContent = `已读 ${task.readCount || 0} 段 · 新增 ${task.createdCount || 0} · 跳过 ${task.skippedCount || 0} · 未匹配 ${task.rejectedCount || 0}${Number.isInteger(task.tokens) ? ` · ${task.tokens} tokens` : ''}`;
      $('task-summary').hidden = !task.summary || running; $('task-summary').textContent = task.summary || '';
    }
    function update(values) {
      tasks = values; const options = $('task-history'); options.replaceChildren(); options.hidden = tasks.length < 2;
      for (const task of tasks) { const option = document.createElement('option'); option.value = task.id; option.textContent = task.prompt.slice(0, 35); options.append(option); }
      if (!tasks.some(t => t.id === selectedId)) selectedId = tasks[0]?.id || null;
      options.value = selectedId || ''; render(tasks.find(t => t.id === selectedId));
    }
    function error(e) { $('task-status').textContent = e.message; $('task-status').className = 'error'; }
    async function refresh() { if (stopped || isInvalid()) return; try { update(await rpc('taskLatest')); } catch (e) { if (panel.open) error(e); } }
    async function action(type) {
      if (working || isInvalid()) return; const prompt = $('task-prompt').value.trim();
      if (type === 'taskStart' && !prompt) { $('task-prompt').focus(); return error(new Error('先写一句要求，或选择上方快捷任务。')); }
      working = true; render(tasks.find(t => t.id === selectedId));
      let failure;
      try {
        if (type === 'taskStart') { if (!requestId || prompt !== lastPrompt) requestId = uid(); lastPrompt = prompt; }
        const task = await rpc(type, type === 'taskStart' ? { id: requestId, prompt } : { id: selectedId });
        selectedId = task.id; panel.open = true; await refresh(); if (type === 'taskStart') requestId = null;
      } catch (e) { failure = e; }
      finally { working = false; render(tasks.find(t => t.id === selectedId)); if (failure) error(failure); }
    }
    $('task-start').addEventListener('click', e => { if (e.isTrusted) action('taskStart'); }); $('task-stop').addEventListener('click', e => { if (e.isTrusted) action('taskStop'); }); $('task-undo').addEventListener('click', e => { if (e.isTrusted) action('taskUndo'); });
    for (const button of panel.querySelectorAll('[data-preset]')) button.addEventListener('click', () => { if (!$('task-prompt').disabled) { $('task-prompt').value = button.dataset.preset; $('task-prompt').focus(); } });
    $('task-history').addEventListener('change', () => { selectedId = $('task-history').value; render(tasks.find(t => t.id === selectedId)); }); panel.addEventListener('toggle', () => { if (panel.open) refresh(); });
    timer = setInterval(() => { if (!ui.getElementById('drawer').hidden && panel.open) refresh(); }, 1800);
    return { refresh, reset() { selectedId = null; update([]); $('task-caption').textContent = '一句话批注当前文章'; $('task-stats').textContent = ''; $('task-summary').hidden = true; }, invalidate() { stopped = true; clearInterval(timer); render(tasks.find(t => t.id === selectedId)); }, prompt: () => $('task-prompt').value };
  }
  root.MojiTaskPanel = { mount };
})(globalThis);
