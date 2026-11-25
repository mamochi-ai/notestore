// Minimal static server for local testing: node tests/serve.mjs [port]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(join(fileURLToPath(import.meta.url), '../..'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.zip': 'application/zip', '.xml': 'application/xml' };
const port = Number(process.argv[2] || 8123);
const base = process.argv[3] ? normalize(process.argv[3]) : root;
http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(base, p));
    if (!f.startsWith(base)) { res.writeHead(403).end(); return; }
    await stat(f);
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(f));
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, () => console.log(`serving ${base} on http://localhost:${port}`));
