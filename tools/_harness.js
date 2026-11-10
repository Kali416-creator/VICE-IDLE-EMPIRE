/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/_harness.js
 * Arranque común de los playtests: servidor estático temporal, navegador,
 * contador de comprobaciones y salida con código de error.
 *
 *   const T = require('./_harness.js').create('playtestX · algo', 25);
 *   T.run(async ({ page, base, ok, evalIn }) => { ... });
 *   T.finish();
 * ===================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8'
};

function serve() {
  // el harness sirve index.html con los datos del build inyectados
  let builtHtml = null;
  try {
    const { build } = require('./build.js');
    builtHtml = require('fs').readFileSync(build({ cloud: true, ethers: null }).out);
  } catch (e) { builtHtml = null; }
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // proxy al backend del juego (/v1/*), igual que tools/serve.js
    if (p.startsWith('/v1/')) {
      const target = new URL(process.env.VICE_BACKEND_URL_ABS || 'http://127.0.0.1:8787');
      const up = http.request({
        hostname: target.hostname, port: target.port || 80, path: req.url,
        method: req.method, headers: Object.assign({}, req.headers, { host: target.host })
      }, upRes => { res.writeHead(upRes.statusCode || 502, upRes.headers); upRes.pipe(res); });
      up.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end('{"ok":false,"error":"backend_unreachable"}');
      });
      req.pipe(up);
      return;
    }
    if ((p === '/index.html' || p === '/vice-idle.html') && builtHtml) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(builtHtml);
      return;
    }
    const full = path.normalize(path.join(ROOT, p));
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404).end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: 'http://127.0.0.1:' + server.address().port });
    });
  });
}

function create(title, expected) {
  const state = { pass: 0, fail: 0, fails: [], expected };
  let srv = null;

  function ok(name, cond, extra) {
    if (cond) { state.pass++; console.log('  ✔ ' + name); }
    else {
      state.fail++;
      state.fails.push(name);
      console.log('  ✘ ' + name + (extra === undefined ? '' : '  → ' + extra));
    }
  }

  async function run(fn) {
    console.log('\n  VICE IDLE · ' + title + '\n');
    const { server, base } = await serve();
    srv = server;
    const { open, loginAs } = await import('./_browser.mjs');
    const page = await open({ url: 'about:blank', viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => { const m = String(e && e.message || e); if (!errors.includes(m)) errors.push(m); });
    try {
      /** Rellena un input como un humano (los handlers de input se disparan). */
      const fill = async (sel, value) => {
        await page.evaluate((s, v) => {
          const el = document.querySelector(s);
          el.focus();
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, sel, value);
      };
      /** Pulsa un elemento que puede estar oculto (modo registro/invitado). */
      const click = async (sel) => {
        await page.evaluate((s) => {
          const el = document.querySelector(s);
          if (!el) throw new Error('no existe ' + s);
          el.click();
        }, sel);
      };
      await fn({ page, base, ok, fill, click, errors });
      if (errors.length) {
        // los errores de JS en página son siempre fallo, aunque no se pregunte
        ok('sin errores de JavaScript en la página', false, errors.slice(0, 3).join(' | '));
      }
    } catch (err) {
      ok('el test terminó sin excepción', false, (err && err.stack || String(err)).split('\n').slice(0, 3).join(' '));
    } finally {
      try { await page.__close(); } catch (e) { /* ignore */ }
      server.close();
    }
  }

  function finish() {
    void srv;
    console.log(`\n  ${state.pass} ok · ${state.fail} fallos${state.expected ? ' (esperados ' + state.expected + ')' : ''}\n`);
    if (state.fails.length) console.log('  fallos: ' + state.fails.join(' · ') + '\n');
    process.exit(state.fail ? 1 : 0);
  }

  return { run, finish, ok, state };
}

/** Azúcar: crea, ejecuta y termina en una sola llamada. */
function runTest(title, expected, fn) {
  const T = create(title, expected);
  T.run(fn).then(() => T.finish()).catch(err => {
    console.error('[harness] excepción:', err);
    process.exit(1);
  });
}

module.exports = { create, runTest, serve, ROOT };
