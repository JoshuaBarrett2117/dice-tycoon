import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@dt/shared';
import { registry } from './registry';
import { MatchRoom } from './rooms/MatchRoom';

const port = Number(process.env.PORT || 2567);
// 生产镜像里把网页客户端放在 STATIC_DIR，同一端口同时提供网页与对战服
const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : '';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** GET /api/rooms：观战列表（跨域放开，开发模式下客户端在另一个端口） */
function serveApi(req: IncomingMessage, res: ServerResponse): boolean {
  const path = (req.url || '/').split('?')[0];
  if (path === '/api/stats' && req.method === 'GET') {
    // 压测用：进程内存与房间数（不含任何玩家数据）
    const m = process.memoryUsage();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576), rooms: registry.list().length, uptimeS: Math.round(process.uptime()) }));
    return true;
  }
  if (path !== '/api/rooms' || (req.method !== 'GET' && req.method !== 'OPTIONS')) return false;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return true; }
  res.writeHead(200, { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ rooms: registry.list() }));
  return true;
}

/** /api/account/*：反向代理到业务服（ACCOUNT_URL，如 http://account:8080），网页与业务服同源，免跨域 */
const accountUrl = (process.env.ACCOUNT_URL || '').replace(/\/$/, '');
function proxyAccount(req: IncomingMessage, res: ServerResponse): boolean {
  if (!(req.url || '').startsWith('/api/account/')) return false;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return true; }
  if (!accountUrl) { res.writeHead(503, { ...cors, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '未配置业务服（ACCOUNT_URL）' })); return true; }
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => { if (chunks.reduce((n, x) => n + x.length, 0) < 1 << 15) chunks.push(c); });
  req.on('end', async () => {
    try {
      const headers: Record<string, string> = { 'content-type': req.headers['content-type'] || 'application/json' };
      if (req.headers.authorization) headers.authorization = String(req.headers.authorization);
      const r = await fetch(accountUrl + req.url, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks), signal: AbortSignal.timeout(8000) });
      res.writeHead(r.status, { ...cors, 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(502, { ...cors, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '业务服暂不可用' }));
    }
  });
  return true;
}

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  if (!staticDir || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url.startsWith('/matchmake') || url.startsWith('/__')) return false;
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return true; }
  let file = normalize(join(staticDir, url));
  if (!file.startsWith(staticDir)) return false;
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, 'index.html');
  if (!existsSync(file)) return false;
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=604800',
  });
  if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  return true;
}

const http = createServer();
const server = new Server({
  transport: new WebSocketTransport({ server: http, pingInterval: 5000, pingMaxRetries: 3 }),
});
// 快速匹配房用 quick 选项区分：joinOrCreate({ quick: true }) 只会匹配到快速匹配房，朋友房（create）不会被误入
server.define(ROOM_NAME, MatchRoom).filterBy(['quick']);
await server.listen(port);

// Colyseus 挂好自己的 HTTP 路由后，在最前面加一层静态文件处理
const colyseusHandlers = http.listeners('request') as ((req: IncomingMessage, res: ServerResponse) => void)[];
http.removeAllListeners('request');
http.on('request', (req, res) => {
  if (proxyAccount(req, res) || serveApi(req, res) || serveStatic(req, res)) return;
  for (const h of colyseusHandlers) h(req, res);
});

console.log(`[掷富天下] 已启动 :${port}${staticDir ? `（网页目录 ${staticDir}）` : '（仅对战服）'}`);
