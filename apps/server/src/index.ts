import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@dt/shared';
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
server.define(ROOM_NAME, MatchRoom);
await server.listen(port);

// Colyseus 挂好自己的 HTTP 路由后，在最前面加一层静态文件处理
const colyseusHandlers = http.listeners('request') as ((req: IncomingMessage, res: ServerResponse) => void)[];
http.removeAllListeners('request');
http.on('request', (req, res) => {
  if (serveStatic(req, res)) return;
  for (const h of colyseusHandlers) h(req, res);
});

console.log(`[掷富天下] 已启动 :${port}${staticDir ? `（网页目录 ${staticDir}）` : '（仅对战服）'}`);
