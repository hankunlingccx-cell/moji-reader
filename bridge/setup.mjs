import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, defaultConfigPath, validateConfig, extensionId } from './config.mjs';
import { BridgeClient } from './client.mjs';
const directory = path.dirname(defaultConfigPath);
await fs.mkdir(directory, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
let config;
try { config = validateConfig(JSON.parse(await fs.readFile(defaultConfigPath, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; config = { app: 'moji-codex-bridge', version: 1, host: '127.0.0.1', port: 38475, token: crypto.randomBytes(32).toString('hex'), extensionId: extensionId(manifest.key) }; await fs.writeFile(defaultConfigPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 }); }
if (config.extensionId !== extensionId(manifest.key)) throw new Error('连接文件与插件 ID 不一致，请保留原文件并重新配置。');
const serverPath = path.join(root, 'bridge', 'mcp-server.mjs');
const toml = `[mcp_servers.moji_reader]\ncommand = ${JSON.stringify(process.execPath.replaceAll('\\', '/'))}\nargs = [${JSON.stringify(serverPath.replaceAll('\\', '/'))}, "--config", ${JSON.stringify(defaultConfigPath.replaceAll('\\', '/'))}]\ntool_timeout_sec = 120\n`;
await fs.writeFile(path.join(directory, 'codex-mcp-config.toml'), toml);
if (process.argv.includes('--install')) {
  const codex = process.env.MOJI_CODEX_BIN || (process.platform === 'win32' ? 'codex.exe' : 'codex');
  const existing = spawnSync(codex, ['mcp', 'get', 'moji_reader', '--json'], { encoding: 'utf8', windowsHide: true });
  if (existing.error) throw new Error('找不到 Codex CLI。配置片段已生成在 .moji/codex-mcp-config.toml，可在桌面 Codex 的 MCP 设置中添加。');
  if (existing.status === 0) {
    const value = JSON.parse(existing.stdout), command = value.transport?.command, args = value.transport?.args || [];
    if (path.resolve(command || '') !== path.resolve(process.execPath) || !args.some(arg => path.resolve(arg) === path.resolve(serverPath))) throw new Error('已存在其他 moji_reader MCP 配置，未覆盖。请使用生成的配置片段手动检查。');
    console.log('现有 moji_reader 配置已匹配，保留原配置。');
  } else {
    const result = spawnSync(codex, ['mcp', 'add', 'moji_reader', '--', process.execPath, serverPath, '--config', defaultConfigPath], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error('Codex MCP 配置未添加成功：' + (result.stderr || result.error?.message || '未知错误'));
    console.log('已将 moji_reader 添加到桌面 Codex 的本地 MCP 配置。');
  }
}
const state = await new BridgeClient(defaultConfigPath).ensure();
console.log('本地连接器已就绪，浏览器连接：' + (state.connected ? '已连接' : '等待插件导入连接文件'));
console.log('连接文件：' + defaultConfigPath);
console.log('请在墨迹标注库 → Codex 自动标注 → 导入此连接文件。桌面 Codex 重新加载 MCP 后即可使用。');
