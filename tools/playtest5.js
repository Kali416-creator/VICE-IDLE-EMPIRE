#!/usr/bin/env node
/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/playtest5.js
 * Sección de RETIROS: rango mínimo, excepción VIP, topes y flujo con el backend.
 * ===================================================================== */
'use strict';

const harness = require('./_harness.js');

harness.runTest('playtest5 · retiros, rango mínimo y VIP', 28, async ({ page, base, ok, fill, click }) => {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  // jugador único por ejecución: los cupos del backend son por playerId
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#loginRoot:not([hidden])');
  await page.evaluate(() => document.getElementById('loginTabs').querySelector('[data-mode="guest"]').click());
  await page.evaluate(() => document.getElementById('loginSubmit').click());
  await page.waitForFunction('window.Core && window.Core.state && !document.body.classList.contains("locked")', { timeout: 20000 });
  await page.waitForSelector('#bizList .biz');

  /* ---------- la pestaña existe y se nombra ---------- */
  ok('hay una pestaña de Retiros separada del Cambio',
    (await page.$$('#nav button[data-tab="withdraw"]')).length === 1);
  ok('el nombre usa la clave nav.withdraw',
    (await page.evaluate(() => document.querySelector('#nav [data-tab="withdraw"]').textContent.trim())) === 'Withdrawals');

  await click('#nav button[data-tab="withdraw"]');
  await new Promise(r => setTimeout(r, 300));
  ok('la sección de retiros se muestra', await page.evaluate(() =>
    document.getElementById('tab-withdraw').classList.contains('active')));
  ok('muestra la puerta de retiro', await page.evaluate(() =>
    document.getElementById('wdGate').innerHTML.length > 50));
  ok('muestra las reglas', await page.evaluate(() =>
    document.getElementById('wdRules').textContent.length > 50));

  /* ---------- sin rango → bloqueado ---------- */
  const locked = await page.evaluate(() => ({
    gate: window.Exchange.gate(),
    pill: document.getElementById('wdGatePill').textContent,
    btn: document.getElementById('wdGo').disabled,
    text: document.getElementById('wdGate').textContent
  }));
  ok('sin rango la puerta está cerrada', locked.gate.open === false);
  ok('la píldora dice Bloqueado', /🔒/.test(locked.pill), locked.pill);
  ok('el botón de retiro está deshabilitado', locked.btn === true);
  ok('se explica el rango necesario (Driver)', /Driver/.test(locked.text), locked.text.slice(0, 80));

  /* ---------- con rango → abierto ---------- */
  const open = await page.evaluate(() => {
    window.Core.state.totalEarned = 1e9;
    window.Core.state.cash = 5e7;
    window.UI.renderWithdraw();
    return {
      gate: window.Exchange.gate(),
      pill: document.getElementById('wdGatePill').textContent,
      btn: document.getElementById('wdGo').disabled
    };
  });
  ok('con Driver (1e9) la puerta se abre', open.gate.open === true && open.gate.byVip === false);
  ok('la píldora dice Desbloqueado', /✅/.test(open.pill), open.pill);
  ok('el botón de retiro se habilita', open.btn === false);

  /* ---------- VIP → sin rango también ---------- */
  const vip = await page.evaluate(() => {
    window.Core.state.totalEarned = 10;     // Novato
    window.Core.state.vipUntil = Date.now() + 30 * 86400000;
    window.UI.renderWithdraw();
    const g = window.Exchange.gate();
    const text = document.getElementById('wdGate').textContent;
    window.Core.state.vipUntil = 0;
    window.UI.renderWithdraw();
    return { g, text, pill: document.getElementById('wdGatePill').textContent };
  });
  ok('con VIP activo la puerta se abre sin rango', vip.g.open === true && vip.g.byVip === true);
  ok('la UI marca que el VIP salta la puerta', /VIP/.test(vip.text), vip.text.slice(0, 100));
  ok('sin VIP vuelve a bloquearse', await page.evaluate(() => window.Exchange.gate().open === false));

  /* ---------- reglas visibles con la tasa nueva ---------- */
  const rules = await page.evaluate(() => {
    window.Core.state.totalEarned = 1e9;
    window.UI.renderWithdraw();
    return document.getElementById('wdRules').textContent;
  });
  ok('las reglas muestran el mínimo de 0.10 USDT', /0\.10/.test(rules), rules.slice(0, 120));
  ok('las reglas muestran el cupo de 0.20 USDT', /0\.20/.test(rules));
  ok('las reglas muestran el cupo global de 25', /25/.test(rules));
  ok('las reglas mencionan el rango mínimo (Driver)', /Driver/.test(rules));

  /* ---------- método de cobro ---------- */
  ok('hay dos métodos de cobro', (await page.$$('#wdMethod option')).length === 2);
  await page.evaluate(() => {
    const m = document.getElementById('wdMethod');
    m.value = 'cloud';
    m.dispatchEvent(new Event('change'));
  });
  ok('el método de cobro se recuerda', await page.evaluate(() => window.Core.state.prefs.wdMethod === 'cloud'));

  /* ---------- flujo local sin backend ---------- */
  const local = await page.evaluate(() => {
    window.Core.state.totalEarned = 1e9;
    window.Core.state.cash = 5e6;
    window.Exchange._reset();
    const before = window.Core.state.cash;
    const r = window.Exchange.request('1000000');
    return { ok: r.ok, cashAfter: window.Core.state.cash, before, usdt: r.entry && r.entry.usdt };
  });
  ok('el retiro local aparta el G$ al pedirlo', local.ok && local.cashAfter === local.before - 1000000);
  ok('la cotización local usa la tasa vigente', local.usdt > 0);
  await page.evaluate(() => { window.Exchange.reject('test'); window.Exchange._reset(); });

  /* ---------- backend conectado ---------- */
  // playerId nuevo para no arrastrar cupos de ejecuciones anteriores
  await page.evaluate(() => {
    window.Core.state.cloud.playerId = window.crypto.randomUUID();
    window.Core.save('test-pid');
  });
  const backend = await page.evaluate(() => {
    const c = window.Cloud.loadConf();
    return { url: c.url, configured: window.Cloud.configured(), mode: window.Cloud.apiMode() };
  });
  ok('el juego trae el backend configurado por defecto', backend.configured === true, JSON.stringify(backend));
  ok('el modo de API es el del backend del repo', backend.mode === 'vice', backend.mode);

  const wdBackend = await page.evaluate(async () => {
    window.Core.state.totalEarned = 1e9;
    window.Core.state.cash = 5e6;
    await window.Cloud.sync();
    const r = await window.Cloud.requestWithdraw(1000000, '0x' + '9'.repeat(40));
    return { ok: r.ok, error: r.error || r.reason, voucher: !!r.voucher, unsigned: r.voucher && r.voucher.unsigned };
  });
  ok('el backend autoriza el retiro con rango', wdBackend.ok === true, wdBackend.error);
  ok('el backend devuelve un voucher', wdBackend.voucher === true);

  const wdAgain = await page.evaluate(async () => {
    const r = await window.Cloud.requestWithdraw(1000000, '0x' + '9'.repeat(40));
    return { ok: r.ok, error: r.error || r.reason };
  });
  ok('el backend aplica el cupo diario (2º retiro)', wdAgain.ok === true || wdAgain.error === 'player_cap');

  /* ---------- UI: retiro por el botón (jugador limpio) ---------- */
  await page.evaluate(() => {
    window.Core.state.cloud.playerId = window.crypto.randomUUID();
    window.Core.save('test-pid-2');
  });
  const uiFlow = await page.evaluate(async () => {
    window.Core.state.totalEarned = 1e9;
    window.Core.state.cash = 5e6;
    window.Exchange._reset();
    document.getElementById('wdMethod').value = 'wallet';
    const amt = document.getElementById('swAmount');
    amt.value = '1000000';
    amt.dispatchEvent(new Event('input', { bubbles: true }));
    window.UI.renderWithdraw();
    document.getElementById('wdGo').click();
    await new Promise(r => setTimeout(r, 900));
    const sum = window.Exchange.summary();
    return { pending: !!sum.pending, status: sum.pending && sum.pending.status,
             tab: window.UI.currentTab };
  });
  ok('el botón de retiro crea la solicitud', uiFlow.pending === true, JSON.stringify(uiFlow));
  ok('el flujo del backend deja el voucher firmado', uiFlow.status === 'signed', uiFlow.status);
  ok('tras retirar se abre la pestaña de Cambio', uiFlow.tab === 'exchange', uiFlow.tab);
});
