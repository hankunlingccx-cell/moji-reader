import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BridgeClient } from './client.mjs';
import { defaultConfigPath } from './config.mjs';
import Article from '../extension/article.js';
import Anchor from '../extension/anchor.js';
import { readingPolicy } from './reading-policy.mjs';

export function createMcpServer(client) {
  const handles = new Map();
  const server = new McpServer({ name: 'moji-reader', version: '1.10.1' }, { instructions: readingPolicy });
  function remember(articleId, handle) {
    handles.set(articleId, handle);
    while (handles.size > 24 || [...handles.values()].reduce((n, h) => n + (h.document?.text.length || 0), 0) > 6000000) handles.delete(handles.keys().next().value);
  }
  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const register = (name, description, inputSchema, handler, readOnly = true) => server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: name === 'moji_undo_batch', idempotentHint: true, openWorldHint: false } }, async args => {
    try { return result(await handler(args)); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  });
  register('moji_connection_status', '查看本地墨迹插件是否连接。不能读取文章时先检查此工具。', {}, () => client.ensure());
  register('moji_list_articles', '列出已打开且可标注的网页标题、URL和tabId。仅在需要选择某篇已打开的文章时调用。', {}, () => client.request('article.list'));
  register('moji_article_outline', '省token入口：获取当前文章或指定已打开网址的章节目录，不返回全文。接着用articleId读取正文章节。', { tabId: z.number().int().positive().optional(), url: z.string().url().optional() }, async args => {
    let tabId = args.tabId;
    if (args.url) {
      const articles = await client.request('article.list'), target = articles.find(a => Anchor.pageKey(a.url) === Anchor.pageKey(args.url) && (tabId === undefined || a.tabId === tabId));
      if (!target) throw new Error('请先在 Chrome 打开指定网址并刷新论文正文，墨迹只读取已打开的网页。');
      tabId = target.tabId;
    }
    const document = await client.request('article.read', { tabId });
    if (document.structure?.version !== 1) throw new Error('请更新墨迹至 v1.9 并刷新论文网页，以启用章节读取。');
    const articleId = crypto.randomUUID();
    remember(articleId, { tabId: document.tabId, url: document.url, sourceHash: document.sourceHash, document, readIds: new Set(), structured: true });
    return { articleId, title: document.title, url: document.url, colors: document.colors, sections: Article.outline(document.structure), extraction: document.structure.extraction, rawChars: document.structure.rawChars, cleanChars: document.structure.cleanChars, removedChars: document.structure.removedChars };
  });
  register('moji_read_article', '有articleId时按sectionIds读去噪正文，paragraphOffset分页；返回段落编号及句子数组（序号从1开始）。省略章节则读全部默认正文。旧tabId入口仍可读取原始全文。', { tabId: z.number().int().positive().optional(), articleId: z.string().optional(), sectionIds: z.array(z.string().max(20)).min(1).max(500).optional(), paragraphOffset: z.number().int().min(0).optional(), offset: z.number().int().min(0).default(0), maxChars: z.number().int().min(1000).max(24000).default(12000) }, async args => {
    let handle = args.articleId ? handles.get(args.articleId) : null;
    if (args.articleId && !handle) throw new Error('文章句柄已过期，请重新读取当前文章。');
    if (handle?.structured || args.sectionIds || args.paragraphOffset !== undefined) {
      if (!handle?.document?.structure) throw new Error('请先调用 moji_article_outline 获取文章句柄。');
      const page = Article.read(handle.document.structure, { sectionIds: args.sectionIds, offset: args.paragraphOffset || 0, maxChars: args.maxChars });
      for (const p of page.paragraphs) handle.readIds.add(p.id);
      return { articleId: args.articleId, ...page };
    }
    const document = await client.request('article.read', { tabId: handle?.tabId ?? args.tabId, expectedUrl: handle?.url });
    if (handle && document.sourceHash !== handle.sourceHash) throw new Error('正文已变化，请重新从头读取，再创建高亮。');
    const articleId = args.articleId || crypto.randomUUID();
    handle = { tabId: document.tabId, url: document.url, sourceHash: document.sourceHash }; remember(articleId, handle);
    const end = Math.min(document.text.length, args.offset + args.maxChars);
    if (args.offset > document.text.length) throw new Error('offset 超出文章长度。');
    return { articleId, title: document.title, url: document.url, sourceHash: document.sourceHash, textLength: document.text.length, offset: args.offset, nextOffset: end < document.text.length ? end : null, text: document.text.slice(args.offset, end), colors: document.colors, existingAnnotationCount: document.existingAnnotationCount };
  });
  register('moji_highlight_passages', '优先用selections批量提交已读paragraphId和sentenceNumbers，免抄原文；省略句子编号选整段。标签与短批注用中文。passages保留旧摘录入口，两者只能用一种。返回可整批撤销的batchId。', {
    articleId: z.string(), batchLabel: z.string().min(1).max(200).default('Codex 自动标注'), task: z.string().max(10000).default(''), dryRun: z.boolean().default(false),
    selections: z.array(z.object({ paragraphId: z.string().regex(/^p[1-9]\d*$/), sentenceNumbers: z.array(z.number().int().positive()).min(1).max(500).optional(), color: z.enum(['yellow', 'blue', 'green', 'rose', 'purple']).default('yellow'), label: z.string().max(200).default('Codex 自动标注'), note: z.string().max(10000).default('') })).min(1).max(200).optional(),
    passages: z.array(z.object({ quote: z.string().min(1).max(20000), color: z.enum(['yellow', 'blue', 'green', 'rose', 'purple']).default('yellow'), label: z.string().max(200).default('Codex 自动标注'), note: z.string().max(10000).default(''), prefix: z.string().max(1000).optional(), suffix: z.string().max(1000).optional(), start: z.number().int().min(0).optional() })).min(1).max(200).optional()
  }, async args => {
    const handle = handles.get(args.articleId); if (!handle) throw new Error('请先通过 moji_read_article 读取当前文章。');
    if (!!args.selections === !!args.passages) throw new Error('请选择 selections 或 passages 中的一种提交方式。');
    const target = { tabId: handle.tabId, url: handle.url, sourceHash: handle.sourceHash };
    if (!args.selections) return client.request('batch.apply', { ...target, batchId: crypto.randomUUID(), label: args.batchLabel, task: args.task, passages: args.passages, dryRun: args.dryRun });
    if (!handle.structured) throw new Error('编号标注需要先查看章节目录，再读取正文。');
    const resolved = Article.resolve(handle.document.structure, args.selections);
    const passages = resolved.passages.filter(p => {
      if (handle.readIds.has(args.selections[p.index].paragraphId)) return true;
      resolved.rejected.push({ index: p.index, reason: '该段落尚未读取，请先阅读再标注。' }); return false;
    });
    if (!passages.length) return { batchId: null, createdCount: 0, rejectedCount: resolved.rejected.length, rejected: resolved.rejected, ...(args.dryRun ? { dryRun: true, matchedCount: 0 } : {}) };
    const batch = await client.request('batch.apply', { ...target, batchId: crypto.randomUUID(), label: args.batchLabel, task: args.task, passages, selectionIndices: passages.map(p => p.index), preRejected: resolved.rejected, dryRun: args.dryRun });
    return args.dryRun ? { dryRun: true, matchedCount: batch.matchedCount, rejectedCount: batch.rejected.length, rejected: batch.rejected } : { batchId: batch.id, createdCount: batch.createdCount, skippedCount: batch.skipped.length, rejectedCount: batch.rejected.length, skipped: batch.skipped, rejected: batch.rejected };
  }, false);
  register('moji_list_batches', '查看Codex创建的批次、批次ID、网页以及尚未撤销的标注数量，可用于找回上次操作并整批撤销。', { url: z.string().optional() }, args => client.request('batch.list', args));
  register('moji_undo_batch', '撤销指定batchId的全部Codex标注，移入回收站，最新笔记和历史仍可恢复；不影响手动标注和其他批次。', { batchId: z.string().min(1).max(80) }, args => client.request('batch.undo', args), false);
  return server;
}
const configIndex = process.argv.indexOf('--config');
const client = new BridgeClient(configIndex === -1 ? defaultConfigPath : process.argv[configIndex + 1]);
// Do not reserve a browser or read any page at startup. The broker is shared by
// local MCP sessions and starts lazily when a tool is first called.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await createMcpServer(client).connect(new StdioServerTransport());
}
