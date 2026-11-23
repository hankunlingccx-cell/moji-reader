(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  async function rpc(type, fields = {}) { const result = await chrome.runtime.sendMessage({ type: 'moji:' + type, ...fields }); if (!result?.ok) throw new Error(result?.error || '连接失败。'); return result.value; }
  function status(value) {
    $('codex-status').textContent = value.message; $('codex-status').classList.toggle('connected', value.connected);
    $('codex-reconnect').disabled = !value.configured; $('codex-disconnect').disabled = !value.enabled;
    $('codex-summary').textContent = value.connected ? '已连接' : value.enabled ? '等待连接' : '未连接';
  }
  async function refresh() {
    try {
      status(await rpc('bridgeStatus'));
      const batches = await rpc('listAiBatches'), list = $('codex-batches'); list.replaceChildren();
      if (!batches.length) { const empty = document.createElement('p'); empty.className = 'meta'; empty.textContent = '尚无 Codex 标注批次。'; list.append(empty); }
      for (const batch of batches) {
        const row = document.createElement('div'); row.className = 'codex-batch';
        const info = document.createElement('div'), title = document.createElement('strong'), description = document.createElement('p');
        title.textContent = batch.label; description.className = 'meta'; description.textContent = `${batch.title} · ${batch.activeCount} / ${batch.totalCount} 条有效 · ${new Date(batch.createdAt).toLocaleString()}`; info.append(title, description);
        const undo = document.createElement('button'); undo.className = 'secondary'; undo.textContent = batch.activeCount ? '整批撤销' : '已撤销'; undo.disabled = !batch.activeCount; undo.dataset.batchId = batch.id;
        undo.addEventListener('click', async () => { undo.disabled = true; try { const result = await rpc('undoAiBatch', { batchId: batch.id }); $('codex-operation-status').textContent = `已撤销 ${result.undoneCount} 条标注，笔记仍保留在回收站。`; await refresh(); } catch (error) { $('codex-operation-status').textContent = error.message; undo.disabled = false; } });
        row.append(info, undo); list.append(row);
      }
    } catch (error) { $('codex-status').textContent = error.message; }
  }
  $('codex-import').addEventListener('click', () => $('codex-connection-file').click());
  $('codex-connection-file').addEventListener('change', async () => {
    const file = $('codex-connection-file').files[0]; if (!file) return;
    try { if (file.size > 10000) throw new Error('请选择连接器生成的小型 connection.json 文件。'); status(await rpc('bridgeConfigure', { config: JSON.parse(await file.text()) })); await refresh(); }
    catch (error) { $('codex-status').textContent = error.message; }
    finally { $('codex-connection-file').value = ''; }
  });
  $('codex-reconnect').addEventListener('click', async () => { try { status(await rpc('bridgeReconnect')); } catch (error) { $('codex-status').textContent = error.message; } });
  $('codex-disconnect').addEventListener('click', async () => { try { status(await rpc('bridgeDisconnect')); } catch (error) { $('codex-status').textContent = error.message; } });
  $('codex-settings').addEventListener('toggle', () => { if ($('codex-settings').open) refresh(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && $('codex-settings').open && Object.keys(changes).some(key => key.startsWith('moji:record:') || key.startsWith('moji:batch:'))) refresh(); });
  setInterval(() => { if ($('codex-settings').open) rpc('bridgeStatus').then(status).catch(() => {}); }, 2000);
  if (location.hash === '#codex') $('codex-settings').open = true;
  rpc('bridgeStatus').then(status).catch(() => {});
})();
