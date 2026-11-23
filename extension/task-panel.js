(function (root) {
  'use strict';
  function mount({ ui, rpc, uid, isInvalid }) {
    const panel = ui.getElementById('codex-task-panel');
    panel.innerHTML = `<style>
      #codex-task-panel{border-bottom:1px solid #e5e5ea;padding:10px 20px;flex-shrink:0;font-size:12px}#codex-task-panel summary{cursor:pointer;list-style:none;color:#007aff;font-weight:600;display:flex;align-items:center;justify-content:space-between}#codex-task-panel summary::-webkit-details-marker{display:none}#codex-task-panel summary span{font-size:10px;font-weight:400;color:#8e8e93}#task-content{padding-top:10px}#task-prompt{width:100%;box-sizing:border-box;min-height:62px;max-height:110px;resize:vertical;background:#f5f5f7;border:1px solid #e5e5ea;border-radius:10px;color:#1c1c1e;padding:9px;font:12px/1.6 -apple-system,system-ui,sans-serif}#task-presets{display:flex;gap:5px;margin:7px 0}#task-presets button{border-radius:12px;background:#f2f2f7;color:#636366;font-size:10px;padding:4px 8px}#task-actions{display:flex;gap:6px}#task-actions button{padding:6px 10px;border-radius:8px;font-size:11px;background:#f2f2f7;color:#007aff}#task-actions #task-start{background:#007aff;color:white}#task-actions button:disabled{opacity:.4;cursor:default}#task-status{line-height:1.7;color:#636366;margin-top:7px;overflow-wrap:anywhere}#task-status.error{color:#d93025}#task-stats{font-size:10px;color:#8e8e93;margin-top:3px}#task-history{width:100%;font-size:10px;border:0;color:#8e8e93;background:#fff;margin-top:6px}#task-execution-hint{font-size:10px;color:#8e8e93;line-height:1.5;margin:7px 0 0}#task-summary{font-size:11px;white-space:pre-wrap;max-height:65px;overflow:auto;color:#636366;margin-top:7px}
    #codex-task-panel summary .task-heading{display:flex;align-items:center;color:#1c1c1e;font-size:13px;font-weight:600}#codex-task-panel summary .task-state{display:flex;align-items:center;gap:7px}.task-chevron{display:inline-block;font-size:14px}#codex-task-panel[open]>summary .task-chevron{transform:rotate(180deg)}#codex-task-panel #task-caption{color:#636366}#task-stats{font-size:11px;color:#636366}#task-prompt{min-height:64px;border-color:transparent;padding:10px;background:#f5f5f7}#task-presets{margin:8px 0 10px;gap:6px}#task-actions button{padding:7px 12px}#task-actions #task-stop{background:#007aff;color:white}#task-result{margin-top:8px}#task-result summary{display:block;color:#007aff;font-size:11px;font-weight:400}#task-usage{font-size:10px;color:#8e8e93;margin-top:5px}#task-connect{margin-top:6px;color:#007aff;font-size:12px}#task-status:empty,#task-stats:empty{display:none}#task-history-panel{margin-top:8px}#task-history-panel>summary{display:block;color:#007aff;font-size:11px;font-weight:400}</style><summary><span class="task-heading">交给 Codex <span data-info="使用独立阅读会话和本机 Codex 额度。默认中文批注，保留双语定位。停止保留已写入标注；整批撤销移入回收站。" aria-label="Codex 任务说明"></span></span><span class="task-state"><span id="task-caption" role="status" aria-live="polite"></span><span class="task-chevron" aria-hidden="true">⌄</span></span></summary><div id="task-content"><textarea id="task-prompt" maxlength="2000" rows="2" aria-label="交给 Codex 的阅读任务" aria-describedby="task-status" placeholder="输入阅读任务…"></textarea><div id="task-presets"><button type="button" data-preset="标出本文的研究方法，用中文简要说明用途。">研究方法</button><button type="button" data-preset="标出本文的主要发现，区分直接证据与作者推测。">主要发现</button><button type="button" data-preset="标出作者明确提到的研究局限，用中文简要说明。">研究局限</button></div><div id="task-actions"><button id="task-start" type="button">开始标注</button><button id="task-stop" type="button" title="停止生成，已写入标注保留" aria-description="停止生成，已写入标注保留" hidden disabled>停止任务</button><button id="task-undo" type="button" title="将本次任务全部标注移入回收站，笔记和历史保留" aria-description="将本次任务全部标注移入回收站，笔记和历史保留" hidden disabled>整批撤销</button></div><div id="task-status" role="status" aria-live="polite" hidden></div><button id="task-connect" type="button" hidden>连接 Codex</button><div id="task-stats"></div><details id="task-history-panel" hidden><summary>历史任务</summary><select id="task-history" aria-label="当前网页的最近阅读任务"></select></details><details id="task-result" hidden><summary>查看结果</summary><div id="task-summary"></div><div id="task-usage"></div></details></div>`;
    MojiInfo.install(ui);
    const $ = id => ui.getElementById(id), active = status => ['starting', 'reading', 'writing', 'stopping'].includes(status);
    const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
    let selectedId = null, tasks = [], working = false, timer, stopped = false, requestId = null, lastPrompt = '';
    function render(task) {
      const running = task && active(task.status);
      $('task-start').disabled = working || running || isInvalid(); $('task-stop').disabled = working || !running || task?.status === 'stopping' || isInvalid();
      $('task-start').hidden = !!running; $('task-stop').hidden = !running;
      $('task-undo').hidden = !task || task.status === 'undone' || (!task.createdCount && !['failed', 'stopped'].includes(task.status));
      $('task-undo').disabled = working || !task || isInvalid(); $('task-prompt').readOnly = !!running && !isInvalid(); $('task-prompt').disabled = false;
      $('task-history').disabled = isInvalid();
      for (const b of panel.querySelectorAll('[data-preset]')) b.disabled = !!running || isInvalid();
      if (!task) { setText('task-caption', ''); setText('task-status', ''); $('task-status').hidden = true; $('task-stats').hidden = true; $('task-result').hidden = true; return; }
      setText('task-caption', { starting: '准备中', reading: '阅读中', writing: '写入中', stopping: '停止中', completed: '已完成', undone: '已撤销', failed: '执行失败', stopped: '已停止' }[task.status] || '');
      const notice = task.status === 'failed' || task.status === 'undone' || /保存失败/.test(task.message);
      $('task-status').hidden = !notice; setText('task-status', notice ? task.message : ''); $('task-status').className = task.status === 'failed' ? 'error' : '';
      const counts = [task.readCount ? `已读 ${task.readCount} 段` : '', task.createdCount || task.status === 'completed' ? `新增 ${task.createdCount || 0}` : '', task.skippedCount ? `跳过 ${task.skippedCount}` : '', task.rejectedCount ? `未匹配 ${task.rejectedCount}` : ''].filter(Boolean);
      $('task-stats').hidden = !counts.length || task.status === 'undone'; setText('task-stats', counts.join(' · '));
      $('task-result').hidden = running || (!task.summary && !Number.isInteger(task.tokens)); setText('task-summary', task.summary || '');
      setText('task-usage', Number.isInteger(task.tokens) ? `Codex 累计用量：${task.tokens} tokens` : '');
    }
    function update(values) {
      tasks = values; $('task-connect').hidden = true; const options = $('task-history'); options.replaceChildren(); options.hidden = false; $('task-history-panel').hidden = tasks.length < 2;
      for (const task of tasks) { const option = document.createElement('option'); option.value = task.id; option.textContent = task.prompt.slice(0, 35); options.append(option); }
      const previousId = selectedId;
      if (!tasks.some(t => t.id === selectedId)) selectedId = tasks[0]?.id || null;
      if (previousId !== selectedId && !$('task-prompt').value.trim()) $('task-prompt').value = tasks.find(t => t.id === selectedId)?.prompt || '';
      options.value = selectedId || ''; render(tasks.find(t => t.id === selectedId));
    }
    function error(e) { $('task-status').hidden = false; setText('task-status', e.message); $('task-status').className = 'error'; $('task-connect').hidden = !/连接|配置/.test(e.message); }
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
    $('task-connect').addEventListener('click', () => rpc('library', { codex: true }).catch(error));
    for (const button of panel.querySelectorAll('[data-preset]')) button.addEventListener('click', () => { if (!$('task-prompt').readOnly) { $('task-prompt').value = button.dataset.preset; $('task-prompt').focus(); } });
    $('task-history').addEventListener('change', () => { selectedId = $('task-history').value; const task = tasks.find(t => t.id === selectedId); $('task-prompt').value = task?.prompt || ''; render(task); }); panel.addEventListener('toggle', () => { if (panel.open) refresh(); });
    timer = setInterval(() => { if (!ui.getElementById('drawer').hidden && (panel.open || tasks.some(t => active(t.status)))) refresh(); }, 1800);
    return { refresh, reset() { selectedId = null; update([]); setText('task-caption', ''); setText('task-stats', ''); $('task-result').hidden = true; }, invalidate() { stopped = true; clearInterval(timer); render(tasks.find(t => t.id === selectedId)); }, prompt: () => $('task-prompt').value };
  }
  root.MojiTaskPanel = { mount };
})(globalThis);
