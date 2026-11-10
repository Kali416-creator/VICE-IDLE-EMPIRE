#!/usr/bin/env node
/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/playtest4.js
 * Cambio local: tasa nueva, mínimos, cupos, vouchers, referidos cosméticos.
 * ===================================================================== */
'use strict';

const harness = require('./_harness.js');

harness.runTest('playtest4 · cambio, vouchers y referidos', 33, async ({ page, base, ok }) => {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#loginRoot:not([hidden])');
  await page.evaluate(() => document.getElementById('loginTabs').querySelector('[data-mode="guest"]').click());
  await page.evaluate(() => document.getElementById('loginSubmit').click());
  await page.waitForFunction('window.Core && window.Core.state && !document.body.classList.contains("locked")', { timeout: 20000 });

  /* ---------- tasa ---------- */
  const rate = await page.evaluate(() => {
    const ep = window.Exchange.epochInfo();
    return {
      rate: ep.rate, epoch: ep.epoch,
      minG: Math.ceil(window.DATA.swap.minUsdt * ep.rate),
      capG: window.DATA.swap.playerDailyCapUsdt * ep.rate,
      data: window.DATA.swap.epochRate,
      step: window.DATA.swap.maxRateStepPct
    };
  });
  ok('la tasa de diseño es 10 000 000 G$ = 1 USDT', rate.data === 10000000, rate.data);
  ok('la tasa está dentro de ±25 % de la de diseño',
    Math.abs(rate.rate / rate.data - 1) <= 0.2501, rate.rate + ' vs ' + rate.data);
  ok('con la tasa de diseño, 1 000 000 G$ = 0.10 USDT',
    Math.abs(1000000 / rate.data - 0.1) < 1e-9);
  ok('el mínimo son 0.10 USDT', await page.evaluate(() => window.DATA.swap.minUsdt === 0.1));
  ok('el cupo diario son 0.20 USDT (= 2 000 000 G$ a la tasa de diseño)',
    Math.abs(rate.capG - 2000000) < 1e-6, rate.capG);
  ok('el cupo global son 25 USDT', await page.evaluate(() => window.DATA.swap.globalDailyCapUsdt === 25));
  ok('la recalibración tiene paso máximo del 60 %', rate.step === 60);
  ok('el cupo equivale a 2 retiros mínimos', Math.abs(rate.capG / rate.minG - 2) < 1e-9, rate.capG / rate.minG);

  /* ---------- puerta de rango ---------- */
  const gate0 = await page.evaluate(() => {
    window.Core.state.cash = 1e9;
    const r = window.Exchange.canRequest(1000000);
    return { ok: r.ok, reason: r.reason, gate: window.Exchange.gate() };
  });
  ok('sin rango no se puede retirar', gate0.ok === false && gate0.reason === 'needRank');
  ok('la puerta indica el rango necesario', gate0.gate.need === 3 && gate0.gate.open === false);
  ok('la puerta anuncia el bypass VIP', gate0.gate.vipBypass === true);

  /* ---------- rango 3 ---------- */
  const gate3 = await page.evaluate(() => {
    window.Core.state.totalEarned = 1e9;
    window.Core.state.cash = 1e9;
    const g = window.Exchange.gate();
    const r = window.Exchange.canRequest(1000000);
    return { g, ok: r.ok, usdt: r.usdt, rank: window.Core.rankIndex() };
  });
  ok('con rango Corredor (1e9) se abre la puerta', gate3.g.open === true && gate3.rank === 3);
  const expectedUsdt = await page.evaluate(() => Math.floor(1000000 / window.Exchange.epochInfo().rate * 1e6) / 1e6);
  ok('la cotización aplica la tasa vigente', Math.abs(gate3.usdt - expectedUsdt) < 1e-9,
    gate3.usdt + ' vs ' + expectedUsdt);

  /* ---------- VIP salta la puerta ---------- */
  const vipGate = await page.evaluate(() => {
    window.Core.state.totalEarned = 500;      // rango 0, sin derecho
    window.Core.state.vipUntil = Date.now() + 86400000;
    const g = window.Exchange.gate();
    const r = window.Exchange.canRequest(1000000);
    window.Core.state.vipUntil = 0;
    return { open: g.open, byVip: g.byVip, ok: r.ok };
  });
  ok('con VIP activo se retira sin rango', vipGate.open === true && vipGate.ok === true);
  ok('la puerta marca que entra por VIP', vipGate.byVip === true);
  ok('sin VIP vuelve a estar cerrada', await page.evaluate(() => window.Exchange.gate().open === false));

  /* ---------- mínimos y cupos ---------- */
  const minCheck = await page.evaluate(() => {
    window.Core.state.totalEarned = 1e9;
    window.Core.state.cash = 1e9;
    return window.Exchange.canRequest(999999);
  });
  ok('por debajo del mínimo se rechaza', minCheck.ok === false && minCheck.reason === 'below_min');

  const quote = await page.evaluate(() => window.Economy.quoteSwap({
    greed: 2000000, rate: 10000000, minUsdt: 0.1, dailyCapUsdt: 0.2, usedTodayUsdt: 0.1
  }));
  ok('si el cupo restante es menor, se recorta', quote.ok && Math.abs(quote.usdt - 0.1) < 1e-9, quote.usdt);

  const overCap = await page.evaluate(() => window.Economy.quoteSwap({
    greed: 5000000, rate: 10000000, minUsdt: 0.1, dailyCapUsdt: 0.2, usedTodayUsdt: 0.2
  }));
  ok('con el cupo agotado no hay cambio', overCap.ok === false && overCap.reason === 'player_cap');

  /* ---------- solicitud ---------- */
  const req = await page.evaluate(() => {
    window.Core.state.totalEarned = 1e9;
    window.Core.state.cash = 5000000;
    window.Exchange._reset();
    const r = window.Exchange.request('1000000');
    return {
      ok: r.ok, entry: r.entry, cash: window.Core.state.cash,
      pending: window.Exchange.summary().pending
    };
  });
  ok('la solicitud queda pendiente', req.ok && req.pending && req.pending.status === 'pending');
  ok('la solicitud aparta el G$', req.cash === 4000000, req.cash);
  ok('la solicitud no consume cupo hasta reclamar', await page.evaluate(() =>
    window.Exchange.usedToday() === 0));

  const dup = await page.evaluate(() => window.Exchange.request('1000000'));
  ok('no se pueden tener dos solicitudes abiertas', dup.ok === false && dup.reason === 'pending');

  /* ---------- voucher ---------- */
  const badVoucher = await page.evaluate(() => {
    const r1 = window.Exchange.applyVoucher('no es json');
    const r2 = window.Exchange.applyVoucher(JSON.stringify({
      player: '0x' + '1'.repeat(40), greed: '1000000', usdt: 0.1,
      deadline: Math.floor(Date.now() / 1000) - 10, nonce: 1, signature: '0x' + 'a'.repeat(130)
    }));
    return { r1: r1.reason, r2: r2.reason };
  });
  ok('un voucher que no es JSON se rechaza', badVoucher.r1 === 'json');
  ok('un voucher caducado se rechaza', badVoucher.r2 === 'expired');

  const goodVoucher = await page.evaluate(() => {
    const v = {
      player: '0x' + '2'.repeat(40), greed: '1000000', usdt: 0.1,
      deadline: Math.floor(Date.now() / 1000) + 600, nonce: 1, signature: '0x' + 'b'.repeat(130)
    };
    const r = window.Exchange.applyVoucher(JSON.stringify(v));
    return { ok: r.ok, status: window.Exchange.summary().pending && window.Exchange.summary().pending.status };
  });
  ok('un voucher válido pasa a firmado', goodVoucher.ok && goodVoucher.status === 'signed');

  const mismatch = await page.evaluate(() => {
    // solicitud limpia para probar el importe
    window.Exchange._reset();
    window.Core.state.cash = 5000000;
    window.Exchange.request('1000000');
    const v = {
      player: '0x' + '2'.repeat(40), greed: '100', usdt: 0.1,
      deadline: Math.floor(Date.now() / 1000) + 600, nonce: 2, signature: '0x' + 'c'.repeat(130)
    };
    const r = window.Exchange.applyVoucher(JSON.stringify(v));
    return r.reason;
  });
  ok('un voucher por importe menor se rechaza', mismatch === 'amount_mismatch', mismatch);

  /* ---------- rechazo (reembolso) ---------- */
  const refund = await page.evaluate(() => {
    const before = window.Core.state.cash;
    const r = window.Exchange.reject('manual');
    return { ok: r.ok, refunded: r.refunded, after: window.Core.state.cash, before };
  });
  ok('rechazar devuelve el G$', refund.ok && refund.after === refund.before + 1000000, JSON.stringify(refund));

  /* ---------- reclamar ---------- */
  const claim = await page.evaluate(() => {
    window.Core.state.cash = 5000000;
    window.Exchange._reset();
    window.Exchange.request('1000000');
    window.Exchange.applyVoucher(JSON.stringify({
      player: '0x' + '3'.repeat(40), greed: '1000000', usdt: 0.1,
      deadline: Math.floor(Date.now() / 1000) + 600, nonce: 3, signature: '0x' + 'd'.repeat(130)
    }));
    const r = window.Exchange.markClaimed('0xdeadbeef');
    return {
      ok: r.ok, used: window.Exchange.usedToday(),
      hist: window.Exchange.summary().history.length,
      pending: window.Exchange.summary().pending
    };
  });
  ok('reclamar cierra la solicitud', claim.ok && claim.pending === null);
  ok('reclamar consume el cupo del día', Math.abs(claim.used - 0.1) < 1e-9, claim.used);
  ok('el historial guarda el cambio', claim.hist >= 1);

  const second = await page.evaluate(() => {
    window.Core.state.cash = 5000000;
    const r = window.Exchange.request('1000000');
    window.Exchange.applyVoucher(JSON.stringify({
      player: '0x' + '4'.repeat(40), greed: '1000000', usdt: 0.1,
      deadline: Math.floor(Date.now() / 1000) + 600, nonce: 4, signature: '0x' + 'e'.repeat(130)
    }));
    const c = window.Exchange.markClaimed('0x2');
    const third = window.Exchange.request('1000000');
    return { second: c.ok, third: third.ok, reason: third.reason, used: window.Exchange.usedToday() };
  });
  ok('2 × 0.10 = cupo exacto del día', second.second && Math.abs(second.used - 0.2) < 1e-9, second.used);
  ok('el tercer cambio del día se rechaza', second.third === false && second.reason === 'player_cap');

  /* ---------- referidos (solo cosmético) ---------- */
  const ref = await page.evaluate(() => {
    const code = window.Exchange.ensureReferralCode();
    const cashBefore = window.Core.state.cash;
    const r = window.Exchange.addReferral('ABC123');
    const cos = window.Exchange.unlockedCosmetics();
    return {
      code, len: code.length, ok: r.ok, count: r.count,
      cashSame: window.Core.state.cash === cashBefore,
      titles: cos.titles.length, skins: cos.skins.length
    };
  });
  ok('cada jugador tiene un código de referido', ref.ok && ref.len === 6, ref.code);
  ok('el referido se cuenta', ref.count === 1);
  ok('el referido NO da dinero', ref.cashSame === true);
  ok('el referido desbloquea cosméticos', ref.titles >= 1 && ref.skins >= 1);

  const self = await page.evaluate(() => {
    window.Exchange._reset();
    window.Exchange.ensureReferralCode();
    return window.Exchange.addReferral(window.Exchange.ensureReferralCode());
  });
  ok('no se puede referir a uno mismo', self.ok === false && self.reason === 'self', self.reason);

  const before = await page.evaluate(() => window.Core.rentaPerSec());
  const after = await page.evaluate(() => {
    window.Core.state.referrals = 99;
    return window.Core.rentaPerSec();
  });
  ok('los referidos no tocan la renta', Math.abs(after - before) < 1e-9, before + ' → ' + after);
});
