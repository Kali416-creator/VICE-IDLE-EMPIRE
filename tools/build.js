#!/usr/bin/env node
/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/build.js
 * Genera `vice-idle.html`: UN fichero autocontenido (CSS + JS inline).
 *
 *   node tools/build.js              # build normal
 *   node tools/build.js --no-cloud   # sin conexión por defecto
 *   node tools/build.js --ethers <r> # inyecta un bundle UMD de ethers
 *
 * Reglas:
 *  - El orden de scripts es el de index.html y NO se puede alterar:
 *      assets/inline.js → economy → data → i18n → core → auth
 *      → exchange → chain → cloud → ui → main
 *  - Falla si los diccionarios de i18n no cuadran (mismo número de claves).
 *  - La clave de Supabase que se inyecta es SOLO la anon public.
 * ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'vice-idle.html');

const SCRIPT_ORDER = [
  'assets/inline.js',
  'src/economy.js',
  'src/data.js',
  'src/i18n.js',
  'js/core.js',
  'js/auth.js',
  'js/exchange.js',
  'js/chain.js',
  'js/backend.js',
  'js/ui.js',
  'js/main.js'
];

/* ---------------- utilidades ---------------- */

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

function parseEnv(file) {
  const out = {};
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return out;
  fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) return;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  });
  return out;
}

/** Verifica que los 3 diccionarios de i18n tienen exactamente las mismas claves. */
function checkI18n() {
  const i18n = require(path.join(ROOT, 'src', 'i18n.js'));
  const { EN, ES, PT } = i18n;
  const base = Object.keys(EN);
  const problems = [];
  [['ES', ES], ['PT', PT]].forEach(([name, dict]) => {
    const missing = base.filter(k => !(k in dict));
    const extra = Object.keys(dict).filter(k => !(k in EN));
    if (missing.length) problems.push(`${name}: faltan ${missing.length} → ${missing.slice(0, 6).join(', ')}`);
    if (extra.length) problems.push(`${name}: sobran ${extra.length} → ${extra.slice(0, 6).join(', ')}`);
  });
  return { count: base.length, problems, langs: [EN, ES, PT].map(d => Object.keys(d).length) };
}

/** Rompe el literal </script> para que no cierre la etiqueta anfitriona. */
function safeInline(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function stripSourceMap(code) {
  return code.replace(/\/\/[#@]\s*sourceMappingURL=.*$/gm, '');
}

function readEthersBundle(arg) {
  if (!arg) return null;
  const p = path.isAbsolute(arg) ? arg : path.join(ROOT, arg);
  if (!fs.existsSync(p)) {
    console.error(`[build] no existe el bundle de ethers: ${p}`);
    process.exit(1);
  }
  const code = stripSourceMap(fs.readFileSync(p, 'utf8'));
  if (!/JsonRpcProvider/.test(code)) {
    console.error('[build] ese fichero no parece ethers v6 (no contiene JsonRpcProvider)');
    process.exit(1);
  }
  return code;
}

/* ---------------- build ---------------- */

function build(opts) {
  const o = Object.assign({ cloud: true, ethers: null, minifyCss: false }, opts || {});
  const t0 = Date.now();

  const i18n = checkI18n();
  if (i18n.problems.length) {
    console.error('[build] i18n desalineado:');
    i18n.problems.forEach(p => console.error('   ' + p));
    process.exit(1);
  }

  const env = parseEnv('.env.local');
  const css = read('css/style.css');
  let html = read('index.html');

  // 1) inline del CSS
  html = html.replace(
    /<link rel="stylesheet" href="css\/style\.css">/,
    () => '<style>\n' + css + '\n</style>'
  );

  // 2) inline de los scripts EN ORDEN
  const scripts = {};
  for (const rel of SCRIPT_ORDER) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      console.error('[build] falta el script ' + rel);
      process.exit(1);
    }
    scripts[rel] = read(rel);
  }

  // datos inyectados
  let inline = scripts['assets/inline.js'];
  inline = inline.replace(
    /var VICE_BUILD = \{[\s\S]*?\};/,
    () => 'var VICE_BUILD = ' + JSON.stringify({
      version: '4.5.0',
      mode: 'single',
      singleFile: true,
      date: new Date().toISOString()
    }, null, 2) + ';'
  );

  if (o.cloud && env.VICE_BACKEND_URL && env.VICE_BACKEND_KEY) {
    inline = inline.replace(
      /var VICE_CLOUD_DEFAULT = null;/,
      () => 'var VICE_CLOUD_DEFAULT = ' + JSON.stringify({
        url: env.VICE_BACKEND_URL,
        key: env.VICE_BACKEND_KEY,
        mode: 'vice'
      }) + '; // backend del juego'
    );
  }

  // despliegues (si existen)
  const depDir = path.join(ROOT, 'contracts', 'deployments');
  const deployments = {};
  if (fs.existsSync(depDir)) {
    for (const f of fs.readdirSync(depDir)) {
      if (!f.endsWith('.json')) continue;
      const net = f.replace(/\.json$/, '');
      try {
        const j = JSON.parse(fs.readFileSync(path.join(depDir, f), 'utf8'));
        if (j && j.viceIdleVault) deployments[net] = j;
      } catch (e) { /* fichero roto: se ignora */ }
    }
  }
  if (Object.keys(deployments).length) {
    inline = inline.replace(
      /var VICE_DEPLOYMENTS = null;/,
      () => 'var VICE_DEPLOYMENTS = ' + JSON.stringify(deployments) + ';'
    );
  }

  // backend por defecto: mismo mecanismo que la nube, sin nombrar proveedor
  // ethers opcional
  if (o.ethers) {
    inline = inline.replace(
      /var VICE_ETHERS_UMD = null;/,
      () => 'var VICE_ETHERS_UMD = ' + JSON.stringify(o.ethers) + ';'
    );
  }

  scripts['assets/inline.js'] = inline;

  const tags = [];
  for (const rel of SCRIPT_ORDER) {
    tags.push('<script>' + safeInline(scripts[rel]) + '</script>');
  }
  const allTags = tags.join('\n');

  // reemplaza el bloque completo de <script src=...>…</script> del final
  const scriptBlock = new RegExp(
    SCRIPT_ORDER.map(s => '<script src="' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"></script>')
      .join('\\s*') + '\\s*</body>'
  );
  if (!scriptBlock.test(html)) {
    console.error('[build] no se encontró el bloque de scripts esperado en index.html');
    process.exit(1);
  }
  html = html.replace(scriptBlock, () => allTags + '\n</body>');

  // banner
  html = html.replace('<!DOCTYPE html>',
    '<!DOCTYPE html>\n<!-- VICE IDLE · NEON EMPIRE — build autocontenido. NO EDITAR A MANO.\n' +
    '     Generado por node tools/build.js desde index.html + src/ + js/ + css/.\n' +
    '     Proyecto de ficción: nada aquí representa ni promueve actividades reales. -->');

  // informa de rutas relativas que quedasen
  const leftovers = [...html.matchAll(/(?:src|href)="((?!https?:|data:|#)[^"]+)"/g)].map(m => m[1]);
  if (leftovers.length) {
    console.log('[build] aviso: recursos no inline →', [...new Set(leftovers)].join(', '));
  }

  fs.writeFileSync(OUT, html, 'utf8');
  const size = fs.statSync(OUT).size;
  return {
    out: OUT,
    bytes: size,
    kb: (size / 1024).toFixed(0),
    keys: i18n.count,
    langs: i18n.langs,
    cloud: !!(o.cloud && env.VICE_BACKEND_URL),
    ethers: !!(o.ethers),
    deployments: Object.keys(deployments),
    ms: Date.now() - t0,
    leftovers: [...new Set(leftovers)]
  };
}

/* ---------------- CLI ---------------- */

if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = { cloud: !args.includes('--no-cloud'), ethers: null };
  const i = args.indexOf('--ethers');
  if (i >= 0) opts.ethers = readEthersBundle(args[i + 1]);

  const r = build(opts);
  console.log('');
  console.log('  VICE IDLE · build');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  salida      ${path.relative(ROOT, r.out)}`);
  console.log(`  tamaño      ${r.kb} KB (${r.bytes.toLocaleString('en-US')} bytes)`);
  console.log(`  i18n        ${r.keys} claves × ${r.langs.length} idiomas (${r.langs.join(' / ')})`);
  console.log(`  nube        ${r.cloud ? "backend inyectado" : "sin conexión por defecto"}`);
  console.log(`  ethers      ${r.ethers ? 'bundle UMD inyectado' : 'lazy (no inyectado)'}`);
  console.log(`  deploys     ${r.deployments.length ? r.deployments.join(', ') : 'ninguno'}`);
  console.log(`  tiempo      ${r.ms} ms`);
  console.log('');
}

module.exports = { build, checkI18n, SCRIPT_ORDER, parseEnv };
