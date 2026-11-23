importScripts('palette.js', 'repository.js', 'codex-bridge.js');
'use strict';
const repo = new MojiRepository.Repository(chrome.storage.local);
function notifyChanged() { chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'moji:changed' })))).catch(console.error); }
const codexBridge = MojiCodexBridge.create(repo, notifyChanged);
// Prevent page content scripts from directly accessing backup and history storage.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.error);
chrome.action.onClicked.addListener(async tab => {
  try { await chrome.tabs.sendMessage(tab.id, { type: 'moji:toggle' }); }
  catch { await chrome.runtime.openOptionsPage(); }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('moji:')) return;
  const run = async () => {
    switch (message.type) {
      case 'moji:bridgeStatus': return codexBridge.status();
      case 'moji:bridgeConfigure':
      case 'moji:bridgeReconnect':
      case 'moji:bridgeDisconnect': {
        if (!sender.url?.startsWith(chrome.runtime.getURL('library.html'))) throw new Error('请在墨迹标注库内设置连接。');
        if (message.type === 'moji:bridgeConfigure') return codexBridge.configure(message.config);
        if (message.type === 'moji:bridgeReconnect') return codexBridge.reconnect();
        return codexBridge.disconnect();
      }
      case 'moji:listAiBatches': return repo.listAiBatches(message.pageKey);
      case 'moji:undoAiBatch': { const result = await repo.undoAiBatch(message.batchId); notifyChanged(); return result; }
      case 'moji:list': return repo.list(message.pageKey);
      case 'moji:learnBilingual': return repo.learnBilingual(message);
      case 'moji:mutate': return repo.mutate(message);
      case 'moji:draft': return repo.saveDraft(message);
      case 'moji:autosave': return repo.autoSaveNote(message);
      case 'moji:palette': return repo.setPalette(message);
      case 'moji:clearDraft': return repo.clearDraft(message.draftId, message.expectedAt);
      case 'moji:history': return repo.history(message.id);
      case 'moji:export': return repo.exportData();
      case 'moji:exported': await chrome.storage.local.set({ 'moji:lastExportAt': Date.now() }); return true;
      case 'moji:import': return repo.importData(message.backup);
      case 'moji:library':
        if (message.palette) await chrome.tabs.create({ url: chrome.runtime.getURL('library.html#palette') });
        else await chrome.runtime.openOptionsPage();
        return true;
      default: throw new Error('未知操作。');
    }
  };
  run().then(value => {
    respond({ ok: true, value: value ?? null });
    if (['moji:mutate', 'moji:import', 'moji:autosave', 'moji:palette'].includes(message.type)) {
      chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.filter(t => t.id !== sender.tab?.id).map(t => chrome.tabs.sendMessage(t.id, { type: 'moji:changed' })))).catch(console.error);
    }
  }, error => respond({ ok: false, error: error.message || String(error) }));
  return true;
});
