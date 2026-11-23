import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Article from '../extension/article.js';
import { CodexSession } from './codex-session.mjs';

const ACTIVE = new Set(['starting', 'reading', 'writing', 'stopping']);
const publicTask = task => Object.fromEntries(Object.entries(task).filter(([key]) => !['document', 'readIds', 'runner', 'runPromise', 'operations', 'timeout', 'lastSignature'].includes(key)));
export class TaskManager {
  constructor({ callExtension, storePath, runnerFactory = options => new CodexSession(options) }) {
    this.callExtension = callExtension; this.storePath = storePath; this.runnerFactory = runnerFactory; this.tasks = new Map(); this.saves = Promise.resolve(); this.ready = this.load(); this.ready.catch(() => {});
  }
  async load() {
    if (!this.storePath) return;
    try { for (const value of JSON.parse(await fs.readFile(this.storePath, 'utf8'))) { if (ACTIVE.has(value.status)) { value.status = 'stopped'; value.message = '连接器已重启，任务已停止；已写入标注仍可整批撤销。'; } this.tasks.set(value.id, value); } }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('任务记录无法读取，请保留原文件并检查连接器。'); }
  }
  save() {
    if (!this.storePath) return Promise.resolve();
    const values = [...this.tasks.values()].map(publicTask).slice(-100);
    this.saves = this.saves.catch(() => {}).then(async () => { await fs.mkdir(path.dirname(this.storePath), { recursive: true }); const temporary = this.storePath + '.' + crypto.randomUUID() + '.tmp'; await fs.writeFile(temporary, JSON.stringify(values), { mode: 0o600 }); await fs.rename(temporary, this.storePath); });
    return this.saves;
  }
  async latest(url) { await this.ready; return [...this.tasks.values()].reverse().filter(t => t.url === url).slice(0, 5).map(publicTask); }
  async start({ id, tabId, url, prompt }) {
    await this.ready;
    if (!/^[\w-]{1,80}$/.test(id || '') || !Number.isInteger(tabId) || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000 || !['http:', 'https:', 'file:'].includes(new URL(url).protocol)) throw new Error('请输入 1–2000 字的阅读任务，并在正文页面开始。');
    if (this.tasks.has(id)) { const old = this.tasks.get(id); if (old.url !== url || old.prompt !== prompt.trim()) throw new Error('任务编号已使用，请重试。'); return publicTask(old); }
    if ([...this.tasks.values()].some(t => ACTIVE.has(t.status))) throw new Error('已有阅读任务正在运行，请先停止或等待完成。');
    const task = { id, tabId, url, prompt: prompt.trim(), status: 'starting', message: '正在准备独立阅读会话…', createdAt: Date.now(), readCount: 0, totalParagraphs: 0, createdCount: 0, skippedCount: 0, rejectedCount: 0, batchIds: [], operations: new Set(), readIds: new Set() };
    this.tasks.set(id, task); try { await this.save(); } catch { this.tasks.delete(id); throw new Error('任务状态无法保存，尚未启动 Codex。请检查本地空间后重试。'); }
    task.runPromise = this.run(task); task.runPromise.catch(() => {}); return publicTask(task);
  }
  async run(task) {
    task.timeout = setTimeout(() => this.stop(task.id, task.url).catch(() => {}), 15 * 60 * 1000);
    try {
      const cwd = path.join(os.tmpdir(), 'moji-reading-workspace'); await fs.mkdir(cwd, { recursive: true });
      task.document = await this.callExtension('article.read', { tabId: task.tabId, expectedUrl: task.url });
      if (task.status !== 'starting') return;
      if (!task.document.structure) throw new Error('请更新扩展并刷新论文页面后重试。');
      task.totalParagraphs = task.document.structure.paragraphs.filter(p => task.document.structure.sections.find(s => s.id === p.sectionId)?.kind !== 'references').length;
      task.runner = this.runnerFactory({ onTool: (name, args) => this.tool(task, name, args), onProgress: value => { Object.assign(task, value); this.save().catch(() => {}); } });
      task.status = 'reading'; task.message = 'Codex 正在读取文章…'; await this.save();
      const result = await task.runner.run({ cwd, prompt: task.prompt + '\n请仅处理本次工具绑定的文章。先获取目录，按章节分页阅读后用编号提交；无需重复复述摘录。' });
      await Promise.allSettled([...task.operations]);
      if (['starting', 'reading', 'writing'].includes(task.status)) {
        task.status = result.status === 'interrupted' ? 'stopped' : task.totalParagraphs > 0 && task.readCount === 0 ? 'failed' : 'completed';
        task.message = task.status === 'completed' ? `已完成 · 新增 ${task.createdCount} 条标注` : task.status === 'failed' ? 'Codex 未能读取正文，没有执行标注。请检查登录和工具环境后重试。' : '任务已停止；已写入标注保留，可整批撤销。';
      }
    } catch (error) { if (!['stopping', 'undone', 'stopped', 'failed'].includes(task.status)) { task.status = 'failed'; task.message = error.message; } }
    finally { clearTimeout(task.timeout); task.runner?.close(); task.finishedAt = Date.now(); await this.save(); }
  }
  async tool(task, name, args = {}) {
    if (!['reading', 'writing'].includes(task.status)) throw new Error('任务已停止，不再读取或写入。');
    const doc = task.document;
    if (name === 'moji_article_outline') return { title: doc.title, colors: doc.colors, sections: Article.outline(doc.structure) };
    if (name === 'moji_read_article') {
      const page = Article.read(doc.structure, { sectionIds: args.sectionIds, offset: args.paragraphOffset || 0, maxChars: 12000 });
      for (const p of page.paragraphs) task.readIds.add(p.id);
      task.readCount = task.readIds.size; task.status = 'reading'; task.message = `正在阅读 · 已读 ${task.readCount} 段`; await this.save(); return page;
    }
    if (name !== 'moji_highlight_passages') throw new Error('本会话仅允许读取和标注当前文章。');
    const resolved = Article.resolve(doc.structure, args.selections);
    const passages = resolved.passages.filter(p => {
      if (task.readIds.has(args.selections[p.index].paragraphId)) return true;
      resolved.rejected.push({ index: p.index, reason: '该段落尚未读取。' }); return false;
    }).map(p => ({ ...p, color: p.color || 'yellow', label: p.label || 'Codex 自动标注', note: p.note || '' }));
    if (!passages.length) { task.rejectedCount += resolved.rejected.length; await this.save(); return { createdCount: 0, rejected: resolved.rejected }; }
    task.status = 'writing'; task.message = '正在写入标注…'; await this.save();
    if (!['reading', 'writing'].includes(task.status)) throw new Error('任务已停止。');
    const operation = this.callExtension('batch.apply', { tabId: task.tabId, url: task.url, sourceHash: doc.sourceHash, batchId: crypto.randomUUID(), taskId: task.id, label: task.prompt.slice(0, 200), task: task.prompt, passages, selectionIndices: passages.map(p => p.index), preRejected: resolved.rejected });
    task.operations.add(operation);
    try {
      const result = await operation;
      task.batchIds.push(result.id); task.createdCount += result.createdCount; task.skippedCount += result.skipped.length; task.rejectedCount += result.rejected.length;
      await this.save(); return { batchId: result.id, createdCount: result.createdCount, skippedCount: result.skipped.length, rejected: result.rejected };
    } catch (error) {
      if (['reading', 'writing'].includes(task.status)) { task.status = 'failed'; task.message = error.message + ' 已写入标注保留，可整批撤销；请检查页面后重新开始。'; task.runner?.close(); }
      throw error;
    } finally { task.operations.delete(operation); }
  }
  async requireTask(id, url) { await this.ready; const task = this.tasks.get(id); if (!task || task.url !== url) throw new Error('未找到当前网页的任务。'); return task; }
  async stop(id, url) {
    const task = await this.requireTask(id, url);
    if (!ACTIVE.has(task.status)) return publicTask(task);
    task.status = 'stopping'; task.message = '正在停止；已写入标注将保留…';
    const interrupt = Promise.resolve().then(() => task.runner?.interrupt()).catch(() => {});
    await this.save().catch(() => {});
    let blockError; try { await this.callExtension('task.block', { taskId: id }); } catch (error) { blockError = error; }
    await Promise.allSettled([...task.operations]);
    // Blocking writes is synchronous at the repository; generation may take a
    // moment to acknowledge cancellation, so terminate our own session too.
    let interruptTimer;
    try { await Promise.race([interrupt, new Promise(resolve => { interruptTimer = setTimeout(resolve, 2000); })]); } finally { clearTimeout(interruptTimer); task.runner?.close(); }
    await interrupt;
    task.status = 'stopped'; task.message = blockError ? '任务已停止，但停止状态保存失败。已写入标注保留，请重连后查看或撤销。' : '任务已停止；已写入标注保留，可整批撤销。'; clearTimeout(task.timeout); await this.save(); return publicTask(task);
  }
  async undo(id, url) {
    const task = await this.requireTask(id, url); if (ACTIVE.has(task.status)) await this.stop(id, url);
    const result = await this.callExtension('task.undo', { taskId: id });
    task.status = 'undone'; task.message = `已撤销 ${result.undoneCount} 条；笔记仍保留在回收站。`; await this.save(); return { ...publicTask(task), undoneCount: result.undoneCount };
  }
  async close() {
    try { await this.ready; } catch { return; } // Never overwrite an unreadable history file.
    for (const task of this.tasks.values()) { clearTimeout(task.timeout); if (ACTIVE.has(task.status)) { task.status = 'stopped'; task.message = '连接器已断开，任务已停止；已写入标注仍可整批撤销。'; } task.runner?.close(); }
    return this.save();
  }
}
