#!/usr/bin/env node
/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/serve.js
 * Servidor estático mínimo para ver el juego y pasar los playtests.
 *
 *   node tools/serve.js                 # http://0.0.0.0:8080
 *   PORT=3000 node tools/serve.js
 *
 * Sirve el repo tal cual, con dos rutas amables:
 *   /            → redirige a /index.html
 *   /vice-idle   → sirve vice-idle.html (build autocontenido)
 * ===================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
// backend del juego: se proxya para que el navegador use el mismo origen
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8787';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function proxyToBackend(req, res, path) {
  let target;
  try { target = new URL(BACKEND); } catch (e) { target = new URL('http://127.0.0.1:8787'); }
  const opts = {
    hostname: target.hostname,
    port: target.port || 80,
    path: path,
    method: req.method,
    headers: Object.assign({}, req.headers, { host: target.host })
  };
  const up = http.request(opts, upRes => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'backend_unreachable' }));
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400).end('bad request');
    return;
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  if (urlPath === '/vice-idle' || urlPath === '/vice-idle/') urlPath = '/vice-idle.html';
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'vice-idle', at: new Date().toISOString() }));
    return;
  }

  // proxy al backend del juego (/v1/* y /backend/health)
  if (urlPath.startsWith('/v1/') || urlPath === '/backend/health') {
    proxyToBackend(req, res, urlPath === '/backend/health' ? '/health' : urlPath);
    return;
  }

  const full = path.normalize(path.join(ROOT, urlPath));
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (urlPath === '/PROMPT.md' || urlPath.startsWith('/.')) {
    res.writeHead(404).end('not found');
    return;
  }

  // index.html se sirve con los datos del build inyectados (como vice-idle.html)
  if (urlPath === '/index.html') {
    try {
      const { build } = require('./build.js');
      const r = build({ cloud: true, ethers: null });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(r.out));
      return;
    } catch (e) {
      // si el build falla, se sirve el multiarchivo original
    }
  }

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + urlPath);
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
      // nada de X-Frame-Options: el preview va dentro de un iframe
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(full).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`VICE IDLE · juego servido en http://${HOST}:${PORT}/`);
  console.log(`  /index.html  → build multiarchivo`);
  console.log(`  /vice-idle   → vice-idle.html autocontenido`);
  console.log(`  /v1/*        → proxy al backend (${BACKEND})`);
});
