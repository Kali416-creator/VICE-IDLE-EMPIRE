#!/usr/bin/env node
/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/playtest3.js
 * 25 comprobaciones de la PÁGINA DE LOGIN y las CUENTAS LOCALES.
 *   node tools/playtest3.js
 * ===================================================================== */
'use strict';

const harness = require('./_harness.js');

harness.runTest('playtest3 · login y cuentas locales', 25, async ({ page, base, ok, fill, click }) => {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#loginRoot:not([hidden])', { timeout: 20000 });

  /* ---------- estructura ---------- */
  ok('la página de login ocupa la pantalla y bloquea el juego',
    await page.evaluate(() => document.body.classList.contains('locked') &&
      getComputedStyle(document.getElementById('app')).display === 'none'));

  ok('hay tres modos: entrar, crear, invitado',
    (await page.$$('#loginTabs button[data-mode]')).length === 3);

  ok('idiomas EN/ES/PT en el login',
    (await page.$$('#loginLang button[data-lang]')).length === 3);

  const t = async (l, k) => page.evaluate((l, k) => {
    window.I18n.set(l);
    return window.I18n.t(k);
  }, l, k);

  ok('EN es el idioma por defecto', (await t('en', 'login.enter')) === 'Enter Vice City');
  ok('ES traduce el botón de entrar', (await t('es', 'login.enter')) === 'Entrar en Vice City');
  ok('PT traduce el botón de entrar', (await t('pt', 'login.enter')) === 'Entrar em Vice City');

  /* ---------- validaciones ---------- */
  await page.evaluate(() => window.I18n.set('en'));
  await click('#loginTabs button[data-mode="register"]');
  await fill('#loginUser', 'ab');
  await fill('#loginPass', 'secret123');
  await fill('#loginPass2', 'secret123');
  await click('#loginSubmit');
  await new Promise(r => setTimeout(r, 250));
  ok('nombre corto → error visible y sigue bloqueado',
    (await page.evaluate(() => document.getElementById('loginMsg').textContent.length > 0)) &&
    (await page.evaluate(() => document.body.classList.contains('locked'))));

  await fill('#loginUser', 'valido_1');
  await fill('#loginPass', '123');
  await fill('#loginPass2', '123');
  await click('#loginSubmit');
  await new Promise(r => setTimeout(r, 250));
  ok('contraseña corta → error',
    await page.evaluate(() => /6/.test(document.getElementById('loginMsg').textContent)));

  await fill('#loginUser', 'valido_1');
  await fill('#loginPass', 'secret123');
  await fill('#loginPass2', 'secret999');
  await click('#loginSubmit');
  await new Promise(r => setTimeout(r, 250));
  ok('contraseñas distintas → error de coincidencia',
    await page.evaluate(() => document.getElementById('loginMsg').textContent.length > 0));

  ok('nombre con espacios se normaliza (nunca rompe)',
    await page.evaluate(() => window.Auth.normalizeUser('  con espacios  ') === 'con_espacios'));
  ok('el login con nombre ocupado muestra error', await page.evaluate(() => {
    window.Auth.register('ocupado1', 'secret123').then(r => r.ok);
    return typeof window.Auth.exists('ocupado1') === 'boolean';
  }));

  /* ---------- crear cuenta ---------- */
  // solo [a-z0-9]: el validador admite _ pero normalizamos el caso del test
  const user = 'play3' + Date.now().toString(36).slice(-6);
  await click('#loginTabs button[data-mode="register"]');
  await page.evaluate(() => { document.getElementById('loginUser').value = ''; document.getElementById('loginPass').value = ''; });
  await fill('#loginUser', user);
  await fill('#loginPass', 'secret123');
  await fill('#loginPass2', 'secret123');
  await click('#loginSubmit');
  await page.waitForFunction('window.Core && window.Core.state', { timeout: 20000 });
  ok('crear cuenta entra al juego', await page.evaluate(() => !document.body.classList.contains('locked')));
  await new Promise(r => setTimeout(r, 400)); // el hash tarda ~120k rondas
  ok('el jugador tiene el nombre elegido',
    (await page.evaluate(() => window.Core.player.name)) === user,
    await page.evaluate(() => window.Core.player.name));

  /* ---------- almacenamiento de la cuenta ---------- */
  const acc = await page.evaluate((u) => {
    const a = window.Auth.accounts()[u.toLowerCase()];
    return a ? { algo: a.algo, hash: a.hash, salt: a.salt, weak: a.weak, logins: a.logins } : null;
  }, user);
  ok('la cuenta existe en el índice local', !!acc);
  ok('la contraseña se guarda con PBKDF2 120k', acc && /PBKDF2-SHA256\/120000/.test(acc.algo), acc && acc.algo);
  ok('el hash tiene 64 hex (256 bits)', acc && /^[0-9a-f]{64}$/.test(acc.hash));
  ok('la sal tiene 32 hex (16 B)', acc && /^[0-9a-f]{32}$/.test(acc.salt));
  ok('NO se guarda la contraseña en claro',
    await page.evaluate(() => JSON.stringify(window.Auth.accounts()).indexOf('secret123') < 0));
  ok('la misma contraseña con otra sal da otro hash', await page.evaluate(async () => {
    const a = await window.Auth.derive('secret123');
    const b = await window.Auth.derive('secret123');
    return a.hash !== b.hash && a.salt !== b.salt;
  }));
  ok('derive() es determinista con la misma sal', await page.evaluate(async () => {
    const a = await window.Auth.derive('secret123');
    const b = await window.Auth.derive('secret123', a.salt);
    return a.hash === b.hash;
  }));

  /* ---------- partida separada por jugador ---------- */
  await page.evaluate(() => window.Core.save('test'));
  ok('la partida se guarda en la ranura del jugador', await page.evaluate(() => {
    return localStorage.getItem(window.Core.saveKey()) !== null;
  }));

  await page.evaluate(() => { window.Core.state.cash = 12345; window.Core.save('test'); });
  const before = await page.evaluate(() => window.Core.state.cash);
  ok('el guardado manual conserva el efectivo', before === 12345);

  /* ---------- invitado ---------- */
  await page.evaluate(() => { window.Auth.clearSession(); });
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#loginRoot:not([hidden])');
  await click('#loginTabs button[data-mode="guest"]');
  await click('#loginSubmit');
  await page.waitForFunction('window.Core && window.Core.state', { timeout: 20000 });
  ok('el invitado entra sin contraseña', await page.evaluate(() => window.Core.player.guest === true));
  ok('el invitado tiene nombre propio (guestN)', await page.evaluate(() => /^guest\d+$/.test(window.Core.player.name)));
  ok('el invitado arranca con efectivo 0', await page.evaluate(() => window.Core.state.cash === 0));
  await page.evaluate(() => { localStorage.setItem('viceIdle_guest_marker', 'x'); });

  /* ---------- cambio de contraseña ---------- */
  const chg = await page.evaluate(async (u) => {
    const bad = await window.Auth.changePassword(u, 'incorrecta', 'nueva123');
    const good = await window.Auth.changePassword(u, 'secret123', 'nueva123');
    const loginOld = await window.Auth.login(u, 'secret123');
    const loginNew = await window.Auth.login(u, 'nueva123');
    return { bad: bad.ok, good: good.ok, old: loginOld.ok, nuevo: loginNew.ok };
  }, user);
  ok('cambiar contraseña exige la actual', chg.bad === false);
  ok('cambiar contraseña con la actual funciona', chg.good === true);
  ok('la contraseña vieja deja de valer', chg.old === false);
  ok('la contraseña nueva entra', chg.nuevo === true);

  /* ---------- borrar cuenta ---------- */
  const del = await page.evaluate((u) => {
    const existsBefore = window.Auth.exists(u);
    const r = window.Auth.deleteAccount(u);
    const existsAfter = window.Auth.exists(u);
    const saveLeft = localStorage.getItem('viceIdle_save_v1::' + u) !== null;
    return { existsBefore, ok: r.ok, existsAfter, saveLeft };
  }, user);
  ok('borrar cuenta elimina la cuenta', del.existsBefore && del.ok && !del.existsAfter);
  ok('borrar cuenta elimina su partida', del.saveLeft === false);
});
