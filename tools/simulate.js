#!/usr/bin/env node
/* =====================================================================
 * VICE IDLE · NEON EMPIRE — tools/simulate.js
 * Simulador de progresión. Usa las MISMAS fórmulas que el juego
 * (src/economy.js + src/data.js). Sin DOM.
 *
 *   node tools/simulate.js                 # tabla de tiempos por rango
 *   node tools/simulate.js --json          # salida JSON (para docs)
 *   node tools/simulate.js --sweep         # barrido de calibración
 * ===================================================================== */
'use strict';

const path = require('path');
const E = require(path.join(__dirname, '..', 'src', 'economy.js'));
const D = require(path.join(__dirname, '..', 'src', 'data.js'));

const HOUR = 3600;

/** Estrategia: compra el negocio con mejor G$/s por G$ gastado si es asequible. */
function simulate(opts) {
  const o = Object.assign({ maxHours: 24 * 400, dt: 1, vip: false, minRentPerSec: 1 }, opts || {});
  const biz = D.businesses.map(b => Object.assign({}, b));
  const owned = {};
  biz.forEach(b => (owned[b.id] = 0));

  let cash = 0, totalEarned = 0, t = 0;
  let buys = 0;
  const milestones = {};     // rankIndex -> hours
  const rankHours = new Array(E.RANKS.length).fill(null);
  let lastBudgetDay = -1, budgetLeft = 0;

  const renta = () => biz.reduce((s, b) => s + owned[b.id] * b.baseIncome, 0);
  const buyCost = b => E.upgradeCost(b.baseCost, owned[b.id], b.growth);

  function bestPurchase() {
    let best = null, bestRatio = Infinity;
    for (const b of biz) {
      const rank = E.rankIndexFor(totalEarned);
      if (b.unlockRank > rank) continue;
      const c = buyCost(b);
      if (c > cash) continue;
      const ratio = c / b.baseIncome;          // G$ por G$/s
      if (ratio < bestRatio) { bestRatio = ratio; best = b; }
    }
    return best;
  }

  while (t < o.maxHours * HOUR) {
    // presupuesto diario (se recalcula cada día UTC con la renta del momento)
    const day = Math.floor(t / 86400);
    if (day !== lastBudgetDay) {
      lastBudgetDay = day;
      budgetLeft = E.dailyBudget(E.rankIndexFor(totalEarned), renta(), o.vip);
    }
    // compras del tick (greedy hasta que no haya nada asequible)
    for (let guard = 0; guard < 500; guard++) {
      const b = bestPurchase();
      if (!b) break;
      cash -= buyCost(b);
      owned[b.id] += 1;
      buys++;
    }
    // producción (si no hay renta todavía, el clic manual mantiene el ritmo:
    // 1 G$/s equivalente mientras el imperio no produzca)
    const gain = E.tickGain(Math.max(renta(), o.minRentPerSec), o.dt, { budgetLeft });
    budgetLeft = gain.budgetLeft;
    cash += gain.paid;
    totalEarned += gain.paid;
    t += o.dt;
    // hitos
    const r = E.rankIndexFor(totalEarned);
    for (let i = 0; i <= r; i++) if (rankHours[i] === null) rankHours[i] = t / HOUR;
    if (rankHours[E.RANKS.length - 1] !== null) break;
  }
  return { rankHours, buys, totalEarned, cash, renta: renta() };
}

function fmt(h) {
  if (h === null) return '—';
  if (h < 1) return (h * 60).toFixed(0) + ' min';
  if (h < 48) return h.toFixed(1) + ' h';
  if (h < 24 * 60) return (h / 24).toFixed(1) + ' d';
  return (h / 24 / 30.4).toFixed(1) + ' meses';
}

function report(extra) {
  const res = simulate(extra);
  const rows = E.RANKS.map((r, i) => ({
    rank: r.index, name: r.name, emoji: r.emoji,
    threshold: r.threshold, hours: res.rankHours[i]
  }));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ rows, buys: res.buys, renta: res.renta }, null, 2));
    return;
  }
  console.log('\n  VICE IDLE · progresión simulada (F2P, juego activo)\n');
  console.log('  #  Rango            Umbral G$     Tiempo acumulado');
  console.log('  ── ──────────────── ────────────── ─────────────────');
  rows.forEach(r => {
    console.log(`  ${String(r.rank).padEnd(2)} ${(r.emoji + ' ' + r.name).padEnd(16)} ${r.threshold.toExponential(0).padEnd(14)} ${fmt(r.hours)}`);
  });
  console.log(`\n  compras totales: ${res.buys} · renta final: ${res.renta.toExponential(2)} G$/s\n`);
}

if (process.argv.includes('--sweep')) {
  // barrido de un factor global de coste para calibrar el ritmo
  console.log('  factor · horas hasta rango 3 · horas hasta rango 7');
  for (const f of [1, 2, 3, 5, 8, 12, 20]) {
    D.businesses.forEach(b => { b.baseCost *= f; });
    const r = simulate({ maxHours: 24 * 400 });
    console.log(`  ×${String(f).padEnd(5)} · ${fmt(r.rankHours[3]).padEnd(20)} · ${fmt(r.rankHours[7])}`);
    D.businesses.forEach(b => { b.baseCost /= f; });
  }
} else {
  report({ maxHours: 24 * 400 });
}

module.exports = { simulate, fmt };
