/* Local, authenticated command channel. No page scripts or arbitrary JS run here. */
(function (root) {
  'use strict';
  function create(repo, notify) {
    const configKey = 'moji:bridgeConfig', alarmName = 'moji:bridge-reconnect';
    let config = null, socket = null, ready = false, lastError = '', generation = 0, retryTimer;
    const clientRequests = new Map(); let taskSupported = false;
    function validate(value) {
      if (value?.app !== 'moji-codex-bridge' || value.version !== 1 || value.host !== '127.0.0.1' || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token || '') || value.extensionId !== chrome.runtime.id) throw new Error('连接文件无效，或不属于当前墨迹插件。请使用连接器生成的 connection.json。');
      return { app: value.app, version: 1, host: '127.0.0.1', port: value.port, token: value.token, extensionId: value.extensionId, enabled: true };
    }
    async function digest(text) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    async function content(tabId, type, extra = {}) {
      const response = await chrome.tabs.sendMessage(tabId, { type, ...extra });
      if (!response?.ok) throw new Error(response?.error || '此页面暂不可读取，请刷新论文的 HTML 正文后重试。');
      return response.value;
    }
    async function readArticle(args) {
      let tabId = args.tabId;
      if (tabId === undefined) tabId = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (!Number.isInteger(tabId)) throw new Error('未找到当前浏览器网页。请打开论文 HTML 正文。');
      let doc;
      try { doc = await content(tabId, 'moji:readDocument'); }
      catch (error) { throw new Error('无法读取目标网页：' + error.message + ' 请切回论文网页，确认已刷新并启用墨迹。'); }
      if (args.expectedUrl && doc.url !== args.expectedUrl) throw new Error('目标标签页已切换到另一篇文章，请重新读取。');
      const saved = await repo.list(doc.url);
      return { ...doc, tabId, sourceHash: await digest(doc.text), colors: saved.palette.colors, existingAnnotationCount: saved.records.filter(r => !r.deleted).length };
    }
    async function dispatch(method, args) {
      if (method === 'article.list') {
        const tabs = await chrome.tabs.query({});
        const results = await Promise.allSettled(tabs.map(async tab => ({ tabId: tab.id, ...await content(tab.id, 'moji:documentInfo') })));
        return results.filter(result => result.status === 'fulfilled').map(result => result.value);
      }
      if (method === 'article.read') return readArticle(args);
      if (method === 'batch.list') return repo.listAiBatches(args.url);
      if (method === 'batch.undo') { const result = await repo.undoAiBatch(args.batchId); notify(); return result; }
      if (method === 'task.block') return repo.blockAiTask(args.taskId);
      if (method === 'task.undo') { const result = await repo.undoAiTask(args.taskId); notify(); return result; }
      if (method !== 'batch.apply') throw new Error('不支持此命令。');
      if (!Number.isInteger(args.tabId) || !/^[a-f0-9]{64}$/.test(args.sourceHash || '') || typeof args.url !== 'string') throw new Error('请先读取文章，获取有效的网页和正文版本。');
      const doc = await readArticle({ tabId: args.tabId, expectedUrl: args.url });
      if (doc.sourceHash !== args.sourceHash) throw new Error('正文已变化，未创建任何高亮；请重新读取文章后再操作。');
      const prepared = await content(args.tabId, 'moji:prepareAiHighlights', { expectedText: doc.text, passages: args.passages, colors: Object.keys(doc.colors) });
      if (args.selectionIndices) {
        if (!Array.isArray(args.selectionIndices) || args.selectionIndices.length !== args.passages.length || args.selectionIndices.some(n => !Number.isInteger(n) || n < 0 || n >= 200)) throw new Error('编号映射无效。');
        for (const item of [...prepared.items, ...prepared.rejected]) item.index = args.selectionIndices[item.index];
      }
      if (args.preRejected) {
        if (!Array.isArray(args.preRejected) || args.preRejected.length > 200) throw new Error('未匹配记录无效。');
        prepared.rejected.push(...args.preRejected);
      }
      if (args.dryRun) return { dryRun: true, matchedCount: prepared.items.length, rejected: prepared.rejected, message: '仅检查匹配，未写入任何标注。' };
      const result = await repo.createAiBatch({ batchId: args.batchId, taskId: args.taskId, pageKey: doc.url, title: doc.title, label: args.label, task: args.task || '', ...prepared });
      notify(); return result;
    }
    function connect() {
      if (!config?.enabled) return;
      const current = ++generation; ready = false; clearTimeout(retryTimer); socket?.close();
      const ws = new WebSocket(`ws://127.0.0.1:${config.port}/extension`); socket = ws;
      ws.onopen = () => { if (current === generation) ws.send(JSON.stringify({ type: 'hello', token: config.token, version: 1 })); };
      ws.onmessage = async event => {
        if (current !== generation) return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'ready') { ready = true; taskSupported = !!message.tasks; lastError = ''; return; }
        if (message.type === 'clientResult') {
          const request = clientRequests.get(message.id); if (!request) return;
          clearTimeout(request.timer); clientRequests.delete(message.id);
          if (message.ok) request.resolve(message.value); else request.reject(new Error(message.error || '阅读任务操作失败。')); return;
        }
        if (message.type === 'error') { lastError = message.error; return; }
        if (message.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
        if (message.type !== 'command' || !ready || typeof message.id !== 'string') return;
        try { const value = await dispatch(message.method, message.args || {}); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'result', id: message.id, ok: true, value })); }
        catch (error) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'result', id: message.id, ok: false, error: error.message })); }
      };
      ws.onerror = () => { if (current === generation && !lastError) lastError = '本地连接器未运行，正在等待 Codex 连接。'; };
      ws.onclose = () => {
        if (current !== generation) return; ready = false; socket = null;
        for (const request of clientRequests.values()) { clearTimeout(request.timer); request.reject(new Error('连接器已断开；已写入标注保留，请重连后查看任务。')); } clientRequests.clear();
        if (config?.enabled) retryTimer = setTimeout(connect, 5000);
      };
    }
    const initialized = chrome.storage.local.get(configKey).then(data => {
      if (!data[configKey]) return;
      config = validate(data[configKey]); config.enabled = !!data[configKey].enabled;
      if (config.enabled) { chrome.alarms.create(alarmName, { periodInMinutes: 1 }); connect(); }
    }).catch(error => { lastError = error.message; });
    chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === alarmName && config?.enabled && !ready && socket?.readyState !== WebSocket.CONNECTING) connect(); });
    return {
      async task(method, args) {
        await initialized;
        if (!ready) throw new Error('请先在“标注库 → Codex 自动标注”连接本地连接器。');
        if (!taskSupported) throw new Error('请重启本地连接器以加载侧栏任务功能。');
        if (!['task.start', 'task.latest', 'task.stop', 'task.undo'].includes(method)) throw new Error('不支持此任务操作。');
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { clientRequests.delete(id); reject(new Error('任务状态响应超时，请查看任务后再重试，避免重复开始。')); }, 55000);
          clientRequests.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ type: 'clientRequest', id, method, args }));
        });
      },
      async configure(value) { await initialized; config = validate(value); lastError = ''; await chrome.storage.local.set({ [configKey]: config }); await chrome.alarms.create(alarmName, { periodInMinutes: 1 }); connect(); return this.status(); },
      async reconnect() { await initialized; if (!config) throw new Error('请先选择 connection.json 连接文件。'); config.enabled = true; await chrome.storage.local.set({ [configKey]: config }); await chrome.alarms.create(alarmName, { periodInMinutes: 1 }); lastError = ''; connect(); return this.status(); },
      async disconnect() { await initialized; generation++; ready = false; clearTimeout(retryTimer); socket?.close(); socket = null; if (config) { config.enabled = false; await chrome.storage.local.set({ [configKey]: config }); } await chrome.alarms.clear(alarmName); return this.status(); },
      async status() { await initialized; return { configured: !!config, enabled: !!config?.enabled, connected: ready, port: config?.port || null, extensionId: chrome.runtime.id, message: ready ? '已连接桌面 Codex' : lastError || (config?.enabled ? '等待本地连接器…' : config ? '已断开，可重新连接' : '尚未配置连接') }; }
    };
  }
  root.MojiCodexBridge = { create };
})(globalThis);
