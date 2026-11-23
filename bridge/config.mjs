import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultConfigPath = path.join(root, '.moji', 'connection.json');
export function validateConfig(value) {
  if (value?.app !== 'moji-codex-bridge' || value.version !== 1 || value.host !== '127.0.0.1' || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token || '') || !/^[a-p]{32}$/.test(value.extensionId || '')) throw new Error('墨迹连接文件格式无效。');
  return { app: value.app, version: 1, host: '127.0.0.1', port: value.port, token: value.token, extensionId: value.extensionId };
}
export async function loadConfig(configPath = defaultConfigPath) { return validateConfig(JSON.parse(await fs.readFile(configPath, 'utf8'))); }
export function extensionId(publicKey) { return [...crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest().subarray(0, 16)].map(byte => 'abcdefghijklmnop'[byte >> 4] + 'abcdefghijklmnop'[byte & 15]).join(''); }
