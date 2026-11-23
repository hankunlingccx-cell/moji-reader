// Deterministic protocol fixture: no model, credentials or network are used.
import { createInterface } from 'node:readline';
const pending = new Map(); let sequence = 0, interrupted = false;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const call = (tool, args) => new Promise((resolve, reject) => { const id = 'tool-' + (++sequence); pending.set(id, { resolve, reject }); send({ id, method: 'item/tool/call', params: { threadId: 'fixture-thread', turnId: 'fixture-turn', callId: id, tool, arguments: args } }); });
const finish = status => send({ method: 'turn/completed', params: { threadId: 'fixture-thread', turn: { id: 'fixture-turn', status } } });
async function run(prompt) {
  await call('moji_article_outline', {}); const result = await call('moji_read_article', {});
  const page = JSON.parse(result.contentItems[0].text), selected = page.paragraphs.slice(-2);
  for (const [i, p] of selected.entries()) {
    if (interrupted) return;
    const phrase = prompt.includes('名词') ? (p.sentences[0].includes('心理安全感') ? '心理安全感' : p.sentences[0].includes('时间压力') ? '过高的时间压力' : p.sentences[0].includes('Psychological') ? 'Psychological safety' : 'High time pressure') : undefined;
    await call('moji_highlight_passages', { selections: [{ paragraphId: p.id, sentenceNumbers: [1], ...(phrase ? { phrase } : {}), color: i ? 'rose' : 'green', label: '团队因素', note: '直接证据：影响团队创意产出。' }] });
    if (prompt.includes('部分停止')) return;
  }
  send({ method: 'item/completed', params: { item: { type: 'agentMessage', text: '已读正文并完成标注。' } } });
  send({ method: 'thread/tokenUsage/updated', params: { tokenUsage: { total: { totalTokens: 321 } } } }); finish('completed');
}
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (!message.method) { const item = pending.get(message.id); if (item) { pending.delete(message.id); if (message.result?.success) item.resolve(message.result); else item.reject(new Error('fixture tool failed')); } return; }
  if (message.method === 'initialized') return;
  let value = {};
  if (message.method === 'account/read') value = { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
  if (message.method === 'config/read') value = { config: { mcp_servers: { unrelated: {} } } };
  if (message.method === 'thread/start') {
    if (!message.params.ephemeral || message.params.sandbox !== 'read-only' || message.params.dynamicTools.length !== 3 || message.params.config['mcp_servers.unrelated.enabled'] !== false) { send({ id: message.id, error: { message: 'fixture requires isolated reader configuration' } }); return; }
    value = { thread: { id: 'fixture-thread' } };
  }
  if (message.method === 'turn/start') { value = { turn: { id: 'fixture-turn' } }; send({ id: message.id, result: value }); run(message.params.input[0].text).catch(() => finish('failed')); return; }
  if (message.method === 'turn/interrupt') { interrupted = true; send({ id: message.id, result: {} }); finish('interrupted'); return; }
  send({ id: message.id, result: value });
});
