#!/usr/bin/env node
/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/playtest2.js
 * Reglas del juego: clic, negocios, mejoras, calor, presupuesto, misiones,
 * diaria, prestigio y guardado.
 * ===================================================================== */
'use strict';

const harness = require('./_harness.js');

harness.runTest('playtest2 · reglas del juego', 30, async ({ page, base, ok }) => {
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#loginRoot:not([hidden])');
  await page.evaluate(() => document.getElementById('loginTabs').querySelector('[data-mode="guest"]').click());
  await page.evaluate(() => document.getElementById('loginSubmit').click());
  await page.waitForFunction('window.Core && window.Core.state && !document.body.classList.contains("locked")', { timeout: 20000 });
  await page.waitForSelector('#bizList .biz');

  /* ---------- estado inicial ---------- */
  const init = await page.evaluate(() => ({
    cash: window.Core.state.cash,
    total: window.Core.state.totalEarned,
    rank: window.Core.rankIndex(),
    heat: window.Core.state.heat,
    businesses: document.querySelectorAll('#bizList .biz').length,
    unlocked: document.querySelectorAll('#bizList .biz:not(.locked)').length,
    keys: window.I18n.KEY_COUNT
  }));
  ok('arranca con 0 G$', init.cash === 0);
  ok('arranca en rango 0', init.rank === 0);
  ok('hay 10 negocios', init.businesses === 10, init.businesses);
  ok('2 negocios desbloqueados al inicio', init.unlocked === 2, init.unlocked);
  ok('i18n con 500+ claves', init.keys >= 500, init.keys);

  /* ---------- clic ---------- */
  const clickRes = await page.evaluate(() => {
    const before = window.Core.state.cash;
    const gain = window.Core.tap();
    return { before, gain, after: window.Core.state.cash, clicks: window.Core.state.clicks };
  });
  ok('el clic suma efectivo', clickRes.after > clickRes.before);
  ok('el clic cuenta como clic', clickRes.clicks === 1);
  ok('el clic sube el calor', await page.evaluate(() => window.Core.state.heat > 0));

  const combo = await page.evaluate(() => {
    window.Core.state.lastActionAt = 0;
    window.Core.tap();
    const g1 = window.Core.state.cash;
    window.Core.tap();
    const g2 = window.Core.state.cash;
    return { c1: window.Core.state.combo, d1: g2 - g1 };
  });
  ok('encadenar clics sube el combo', combo.c1 > 1, combo.c1);

  /* ---------- comprar negocio ---------- */
  await page.evaluate(() => { window.Core.state.cash = 1e6; });
  const buy = await page.evaluate(() => {
    const r = window.Core.buyBusiness('kiosk', '1');
    return { ok: r.ok, qty: r.qty, owned: window.Core.bizCount('kiosk'), cash: window.Core.state.cash };
  });
  ok('comprar 1 unidad descuenta el precio', buy.ok && buy.owned === 1 && buy.cash < 1e6);
  ok('la compra multiplica el precio', await page.evaluate(() =>
    window.Economy.upgradeCost(15, 1, 1.15) > 15));

  const buy10 = await page.evaluate(() => {
    const before = window.Core.bizCount('kiosk');
    const r = window.Core.buyBusiness('kiosk', '10');
    return { before, after: window.Core.bizCount('kiosk'), r };
  });
  ok('comprar x10 añade 10 unidades', buy10.after - buy10.before === 10, JSON.stringify(buy10.r));

  const buyMax = await page.evaluate(() => {
    window.Core.state.cash = 1e9;
    const before = window.Core.bizCount('kiosk');
    window.Core.buyBusiness('kiosk', 'max');
    return window.Core.bizCount('kiosk') - before;
  });
  ok('comprar MAX gasta todo lo asequible', buyMax > 10, buyMax);

  const locked = await page.evaluate(() => window.Core.buyBusiness('satellite', '1'));
  ok('un negocio bloqueado no se puede comprar', locked.ok === false && locked.reason === 'locked');

  /* ---------- renta ---------- */
  const renta = await page.evaluate(() => ({
    r: window.Core.rentaPerSec(),
    eff: window.Core.effectiveRenta()
  }));
  ok('los negocios generan renta', renta.r > 0);
  ok('la renta efectiva no supera la nominal (calor)', renta.eff <= renta.r + 1e-9);

  /* ---------- mejoras ---------- */
  const upg = await page.evaluate(() => {
    window.Core.state.cash = 1e9;
    const before = window.Core.rentaPerSec();
    const r = window.Core.buyUpgrade('logistics');
    return { ok: r.ok, level: r.level, before, after: window.Core.rentaPerSec() };
  });
  ok('comprar una mejora global sube la renta', upg.ok && upg.after > upg.before, JSON.stringify(upg));
  ok('la mejora sube de nivel', upg.level === 1);

  const maxed = await page.evaluate(() => {
    window.Core.state.cash = 1e30;
    let last;
    for (let i = 0; i < 20; i++) last = window.Core.buyUpgrade('neonSign');
    return last;
  });
  ok('una mejora al máximo rechaza más compras', maxed.ok === false && maxed.reason === 'maxed');

  /* ---------- presupuesto diario ---------- */
  const budget = await page.evaluate(() => {
    const b = window.Core.ensureBudget();
    window.Core.state.budget.left = 0;
    const r = window.Economy.tickGain(1000, 1, { budgetLeft: 0 });
    window.Core.state.budget.left = b.total;
    return { total: b.total, trickle: r.paid, dripped: r.dripped };
  });
  ok('el presupuesto diario es positivo', budget.total > 0);
  ok('sin presupuesto solo gotea el 10 %', Math.abs(budget.trickle - 100) < 1e-6, budget.trickle);
  ok('el goteo se marca como dripped', Math.abs(budget.dripped - 100) < 1e-6);

  const hours = await page.evaluate(() => ({
    f2p: window.Economy.dailyHoursFor(3, false),
    vip: window.Economy.dailyHoursFor(3, true)
  }));
  ok('VIP = F2P × 4/3', Math.abs(hours.vip - hours.f2p * 4 / 3) < 1e-9, JSON.stringify(hours));

  /* ---------- calor y redada ---------- */
  const raid = await page.evaluate(() => {
    window.Core.state.cash = 1000;
    window.Core.state.heat = 99.9;
    window.Core.addHeat(10);
    return { heat: window.Core.state.heat, cash: window.Core.state.cash, raids: window.Core.state.counters.raids };
  });
  ok('la redada se lleva el 25 % del efectivo', Math.abs(raid.cash - 750) < 1e-6, raid.cash);
  ok('la redada baja el calor a la mitad', Math.abs(raid.heat - 50) < 1e-6, raid.heat);
  ok('la redada queda contada', raid.raids === 1);

  /* ---------- misiones ---------- */
  const mis = await page.evaluate(() => {
    const list = window.Core.state.missions.list;
    const m = window.DATA.missions.find(x => x.id === list[0]);
    window.Core.state.missions.progress[m.id] = m.target;
    const r = window.Core.claimMission(m.id);
    const again = window.Core.claimMission(m.id);
    return { n: list.length, ok: r.ok, reward: r.reward, again: again.ok, planned: m.reward };
  });
  ok('hay 3 misiones al día', mis.n === 3, mis.n);
  ok('una misión completa se puede reclamar', mis.ok && mis.reward === mis.planned);
  ok('una misión no se reclama dos veces', mis.again === false);

  /* ---------- diaria ---------- */
  const daily = await page.evaluate(() => {
    window.Core.state.daily.lastDay = null;
    window.Core.state.daily.streak = 0;
    const r = window.Core.claimDaily(Date.now());
    const again = window.Core.claimDaily(Date.now());
    return { ok: r.ok, reward: r.reward, streak: r.streak, again: again.ok };
  });
  ok('la diaria se reclama una vez al día', daily.ok && daily.again === false);
  ok('la diaria da su recompensa', daily.reward >= 800);

  /* ---------- prestigio ---------- */
  const pre = await page.evaluate(() => {
    window.Core.state.totalEarned = 1e9;
    const r = window.Core.prestige();
    return { ok: r.ok, points: r.points, style: window.Core.state.style,
             cash: window.Core.state.cash, biz: window.Core.bizCount('kiosk'),
             mult: window.Economy.prestigeMultiplier(r.points) };
  });
  ok('con 1e9 se puede prestigiar', pre.ok && pre.points === 1);
  ok('el prestigio conserva el estilo', pre.style === 1);
  ok('el prestigio reinicia efectivo y negocios', pre.cash === 0 && pre.biz === 0);
  ok('el estilo da multiplicador permanente', pre.mult > 1);

  /* ---------- guardado ---------- */
  const save = await page.evaluate(() => {
    window.Core.state.cash = 4242;
    const okSave = window.Core.save('test');
    const raw = localStorage.getItem(window.Core.saveKey());
    return { okSave, hasSlot: !!raw, cash: JSON.parse(raw || '{}').cash };
  });
  ok('el guardado escribe la ranura del jugador', save.okSave && save.hasSlot);
  ok('la ranura contiene el efectivo', save.cash === 4242, save.cash);
});
