/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/_browser.mjs
 * Arranque de navegador para los playtests y las capturas.
 *
 * Este entorno no permite apt-get, así que el Chromium headless viene del
 * paquete npm @sparticuz/chromium y las librerías NSS/NSPR se compilan
 * aparte (ver tools/README.md). Si existe Playwright, se usa Playwright.
 *
 * API mínima y estable para los tests:
 *   const { open } = await import('./_browser.mjs');
 *   const page = await open({ url });   // page.evaluate, page.click, ...
 * ===================================================================== */
import fs from 'fs';
import path from 'path';

const NSS_DIR = process.env.VICE_NSS_DIR || '/home/user/.local/nsslib';
const MOD_DIR = process.env.VICE_BROWSER_MODULES || '/home/user/tools-browser/node_modules';

function setLibPath() {
  if (!fs.existsSync(NSS_DIR)) return;
  const cur = process.env.LD_LIBRARY_PATH || '';
  if (!cur.includes(NSS_DIR)) process.env.LD_LIBRARY_PATH = NSS_DIR + (cur ? ':' + cur : '');
}

export async function launch(opts = {}) {
  setLibPath();
  const chromiumMod = path.join(MOD_DIR, '@sparticuz/chromium/build/index.js');
  const puppeteerMod = path.join(MOD_DIR, 'puppeteer-core/lib/puppeteer/puppeteer-core.js');
  if (!fs.existsSync(chromiumMod) || !fs.existsSync(puppeteerMod)) {
    throw new Error(
      'Faltan los módulos de navegador. Instálalos con:\n' +
      '  npm i --prefix /home/user/tools-browser @sparticuz/chromium puppeteer-core\n' +
      'y compila NSS/NSPR en /home/user/.local/nsslib (ver tools/README.md).'
    );
  }
  const { default: chromium } = await import(chromiumMod);
  const { default: puppeteer } = await import(puppeteerMod);
  const exe = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    executablePath: exe,
    headless: opts.headless === undefined ? 'shell' : opts.headless,
    defaultViewport: opts.viewport || { width: 1440, height: 900, deviceScaleFactor: 1 }
  });
  return browser;
}

export async function open(opts = {}) {
  const browser = await launch(opts);
  const page = await browser.newPage();
  const errors = [];
  const logs = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => {
    const text = m.text();
    logs.push({ type: m.type(), text });
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(text)) errors.push('console: ' + text);
  });
  page.__errors = errors;
  page.__logs = logs;
  if (opts.url) await page.goto(opts.url, { waitUntil: 'load', timeout: 30000 });
  page.__close = async () => { try { await browser.close(); } catch (e) { /* ignore */ } };
  return page;
}

/** Espera a que la app haya arrancado (login pintado o juego montado). */
export async function waitReady(page, timeout = 15000) {
  await page.waitForFunction(
    'typeof window.Main !== "undefined" && (document.getElementById("loginRoot") && !document.getElementById("loginRoot").hidden || window.Core && window.Core.state)',
    { timeout }
  );
}

/** Crea cuenta nueva y entra al juego (deja la partida lista). */
export async function loginAs(page, user, pass) {
  await page.waitForSelector('#loginRoot:not([hidden])', { timeout: 15000 });
  await page.click('#loginTabs button[data-mode="register"]');
  await page.type('#loginUser', user);
  await page.type('#loginPass', pass);
  await page.type('#loginPass2', pass);
  await page.click('#loginSubmit');
  await page.waitForFunction('window.Core && window.Core.state && !document.body.classList.contains("locked")', { timeout: 20000 });
  await page.waitForSelector('#bizList .biz', { timeout: 10000 });
}

export async function guest(page) {
  await page.waitForSelector('#loginRoot:not([hidden])', { timeout: 15000 });
  await page.click('#loginTabs button[data-mode="guest"]');
  await page.click('#loginSubmit');
  await page.waitForFunction('window.Core && window.Core.state && !document.body.classList.contains("locked")', { timeout: 20000 });
}

export async function shot(page, file, full) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: file, fullPage: !!full });
  return file;
}
