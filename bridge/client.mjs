import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, defaultConfigPath } from './config.mjs';
const brokerPath = fileURLToPath(new URL('./broker.mjs', import.meta.url));
export class BridgeClient {
  constructor(configPath = defaultConfigPath, { autoStart = true } = {}) { this.configPath = path.resolve(configPath); this.autoStart = autoStart; }
  async health() {
    const config = await loadConfig(this.configPath);
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, { headers: { Authorization: 'Bearer ' + config.token }, signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('连接端口被占用，或连接文件不匹配。');
    const status = await response.json(); if (status.app !== 'moji-codex-bridge' || status.extensionId !== config.extensionId) throw new Error('连接器身份不匹配。');
    return status;
  }
  async ensure() {
    try { return await this.health(); }
    catch (error) {
      if (!this.autoStart || !/fetch failed|aborted|timeout|ECONNREFUSED/i.test(error.message)) throw error;
      await loadConfig(this.configPath);
      const process = spawn(globalThis.process.execPath, [brokerPath, '--config', this.configPath], { stdio: 'ignore', windowsHide: true, detached: false });
      let spawnError = null; process.on('error', error => { spawnError = error; }); process.unref();
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (spawnError) throw spawnError;
        try { return await this.health(); } catch {}
      }
      throw new Error('本地连接器无法启动。请运行 npm run bridge:doctor 查看状态。');
    }
  }
  async request(method, args = {}) {
    await this.ensure(); const config = await loadConfig(this.configPath);
    const response = await fetch(`http://127.0.0.1:${config.port}/rpc`, { method: 'POST', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }), signal: AbortSignal.timeout(55000) });
    const result = await response.json(); if (!result.ok) throw new Error(result.error || '墨迹连接器执行失败。'); return result.value;
  }
}
