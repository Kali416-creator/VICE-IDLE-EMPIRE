/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/_login.js
 * Helpers de login para los playtests (equivalente a ensureSigned/ensureGuest).
 * ===================================================================== */
'use strict';

/**
 * Entra con una cuenta existente o la crea si no existe.
 * Deja la partida arrancada y esperada.
 */
async function ensureSigned(page, user = 'tester', pass = 'secret123') {
  await page.waitForSelector('#loginRoot:not([hidden])', { timeout: 20000 });
  await page.click('#loginTabs button[data-mode="login"]');
  await page.evaluate(() => { document.getElementById('loginUser').value = ''; document.getElementById('loginPass').value = ''; });
  await page.type('#loginUser', user);
  await page.type('#loginPass', pass);
  await page.click('#loginSubmit');
  // si no existe la cuenta, el aviso sale y creamos
  const failed = await page.evaluate(() => {
    return new Promise(resolve => {
      setTimeout(() => {
        const msg = (document.getElementById('loginMsg') || {}).textContent || '';
        resolve(msg.length > 0 && !document.body.classList.contains('locked') === false && msg.length > 0);
      }, 900);
    });
  });
  if (await page.evaluate(() => !document.getElementById('loginRoot').hidden)) {
    await page.click('#loginTabs button[data-mode="register"]');
    await page.evaluate(() => {
      document.getElementById('loginUser').value = '';
      document.getElementById('loginPass').value = '';
      document.getElementById('loginPass2').value = '';
    });
    await page.type('#loginUser', user);
    await page.type('#loginPass', pass);
    await page.type('#loginPass2', pass);
    await page.click('#loginSubmit');
  }
  void failed;
  await waitGame(page);
  return user;
}

async function ensureGuest(page) {
  await page.waitForSelector('#loginRoot:not([hidden])', { timeout: 20000 });
  await page.click('#loginTabs button[data-mode="guest"]');
  await page.click('#loginSubmit');
  await waitGame(page);
}

async function waitGame(page) {
  await page.waitForFunction(
    'window.Core && window.Core.state && document.body.classList.contains("locked") === false',
    { timeout: 30000 }
  );
  await page.waitForSelector('#bizList .biz', { timeout: 15000 });
}

/** Espera N ms reales sin depender del reloj del juego. */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { ensureSigned, ensureGuest, waitGame, sleep };
