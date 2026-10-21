/* 本機靜態伺服器（PDF 構建專用）
 * 綁 localhost 隨機埠，供 Playwright Chromium 載入原始站。
 * 用途：npm run build 內部啟動，結束時一律關閉（server.close + 子行程 kill）。
 * 防 path traversal：URL 路徑正規化後必須落在 root 內。
 * 用法：node scripts/static-server.mjs <root> <port>
 *   port 0 → 隨機埠；開埠後將 port 寫到 stdout 最後一行（"LISTENING <port>"）。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';

const root = resolve(process.argv[2] || '.');
const wantedPort = Number(process.argv[3] || 0);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function safePath(urlPath) {
  // decode → strip query/fragment 已在上層；正規化後必須仍在 root 下。
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  p = p.replace(/^\/+/, '');
  const abs = resolve(join(root, p));
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    let p = u.pathname;
    if (p === '/' || p === '') p = '/index.html';
    const abs = safePath(p);
    if (!abs) { res.writeHead(400, { 'content-type': 'text/plain' }); res.end('bad path'); return; }
    let target = abs;
    try {
      const st = await stat(abs);
      if (st.isDirectory()) target = join(abs, 'index.html');
    } catch { /* 不存在 → 404 */ }
    let buf;
    try { buf = await readFile(target); } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return;
    }
    const ext = extname(target).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': buf.length,
      // 構建環境不需快取；也避免與 update.js 的版本偵測互相干擾。
      'cache-control': 'no-store',
    });
    res.end(buf);
  } catch (err) {
    try { res.writeHead(500); res.end('server error'); } catch { /* 已斷 */ }
    console.error('static-server request error:', err.message);
  }
});

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await new Promise((r) => server.close(r)); // 等待既有請求完成（含 9MB JS 下載）
  } catch { /* 忽略 */ }
  process.exit(code);
}
server.on('error', (err) => { console.error('static-server error:', err); shutdown(1); });
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

server.listen(wantedPort, '127.0.0.1', () => {
  console.log(`LISTENING ${server.address().port}`);
});
