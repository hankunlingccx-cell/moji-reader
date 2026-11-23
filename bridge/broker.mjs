import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, defaultConfigPath } from './config.mjs';
import { TaskManager } from './tasks.mjs';

export async function startBroker(config, { taskStorePath, runnerFactory } = {}) {
  const pending = new Map(); let peer = null;
  const equal = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(config.token));
  const gateway = new WebSocketServer({ noServer: true, maxPayload: 12 * 1024 * 1024 });
  function callExtension(method, args) {
    if (!peer || peer.readyState !== WebSocket.OPEN) throw new Error('墨迹插件尚未连接。请在 Chrome 的墨迹标注库中导入 connection.json，并点击连接。');
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('浏览器操作超时。请确认论文网页已加载，重试前可先查看批次列表。')); }, 45000);
      pending.set(id, { resolve, reject, timer });
      peer.send(JSON.stringify({ type: 'command', id, method, args }));
    });
  }
  function answer(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
  const tasks = new TaskManager({ callExtension, storePath: taskStorePath, runnerFactory });
  const server = http.createServer(async (req, res) => {
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${config.port}` || !equal(req.headers.authorization?.replace(/^Bearer /, ''))) return answer(res, 403, { error: 'Unauthorized' });
    if (req.method === 'GET' && req.url === '/health') return answer(res, 200, { app: 'moji-codex-bridge', version: 1, connected: peer?.readyState === WebSocket.OPEN, extensionId: config.extensionId, capabilities: ['sidebar-tasks'] });
    if (req.method !== 'POST' || req.url !== '/rpc') return answer(res, 404, { error: 'Not found' });
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 10 * 1024 * 1024) throw new Error('请求过大。'); chunks.push(chunk); }
      const command = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!['article.list', 'article.read', 'batch.apply', 'batch.list', 'batch.undo'].includes(command.method)) throw new Error('不支持此操作。');
      const value = await callExtension(command.method, command.args || {}); answer(res, 200, { ok: true, value });
    } catch (error) { answer(res, 400, { ok: false, error: error.message }); }
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/extension' || req.headers.host !== `127.0.0.1:${config.port}` || req.headers.origin !== `chrome-extension://${config.extensionId}`) { socket.destroy(); return; }
    gateway.handleUpgrade(req, socket, head, ws => gateway.emit('connection', ws));
  });
  gateway.on('connection', ws => {
    let authenticated = false;
    const authTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 4000);
    ws.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (!authenticated) {
          if (message.type !== 'hello' || !equal(message.token)) { ws.close(1008, 'Invalid connection file'); return; }
          if (peer && peer.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: 'error', error: '另一个浏览器已连接，请先在原浏览器断开。' })); ws.close(1008, 'Already connected'); return; }
          clearTimeout(authTimer); authenticated = true; peer = ws; ws.send(JSON.stringify({ type: 'ready', version: 1, tasks: true })); return;
        }
        if (message.type === 'pong') return;
        if (message.type === 'clientRequest' && typeof message.id === 'string') {
          const run = async () => {
            const args = message.args || {};
            if (message.method === 'task.start') return tasks.start(args);
            if (message.method === 'task.latest') return tasks.latest(args.url);
            if (message.method === 'task.stop') return tasks.stop(args.id, args.url);
            if (message.method === 'task.undo') return tasks.undo(args.id, args.url);
            throw new Error('不支持此任务命令。');
          };
          run().then(value => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'clientResult', id: message.id, ok: true, value })); }, error => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'clientResult', id: message.id, ok: false, error: error.message })); }); return;
        }
        if (message.type !== 'result' || typeof message.id !== 'string') return;
        const request = pending.get(message.id); if (!request) return;
        clearTimeout(request.timer); pending.delete(message.id);
        if (message.ok) request.resolve(message.value); else request.reject(new Error(message.error || '浏览器执行失败。'));
      } catch { ws.close(1008, 'Invalid message'); }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (peer === ws) {
        peer = null;
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('浏览器连接已断开。请查看批次列表确认操作结果后重试。')); }
        pending.clear();
        tasks.close().catch(() => {});
      }
    });
  });
  const heartbeat = setInterval(() => { if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: 'ping' })); }, 20000);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
  return {
    server,
    async close() { await tasks.close(); clearInterval(heartbeat); for (const ws of gateway.clients) ws.terminate(); gateway.close(); await new Promise(resolve => server.close(resolve)); }
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configIndex = process.argv.indexOf('--config'), configPath = configIndex === -1 ? defaultConfigPath : process.argv[configIndex + 1];
  startBroker(await loadConfig(configPath), { taskStorePath: path.join(path.dirname(configPath), 'reading-tasks.json') }).catch(error => { console.error('墨迹连接器启动失败：' + error.message); process.exitCode = 1; });
}
