/* =====================================================================
 * VICE IDLE · NEON EMPIRE — src/economy.js
 * Fórmulas PURAS de la economía. Sin DOM, sin estado global.
 * Las usan el juego (navegador) y el simulador (node tools/simulate.js).
 * Regla: aquí no se decide ningún pago; el dinero real solo lo mueve el
 * contrato. Este módulo solo produce números de G$ (moneda blanda cerrada).
 * ===================================================================== */
(function (root) {
  'use strict';

  /* ---------- constantes de diseño (NO tocar sin análisis escrito) ---------- */

  // Rangos: umbral sobre G$ ganados de por vida (totalEarned, nunca baja).
  var RANKS = [
    { index: 0, key: 'rookie', name: 'Novato',        emoji: '🐣', threshold: 0,          f2pHours: 6.0,  floorBudget: 1e3 },
    { index: 1, key: 'snitch', name: 'Soplón',        emoji: '👀', threshold: 1e3,        f2pHours: 6.5,  floorBudget: 1e5 },
    { index: 2, key: 'thug',   name: 'Matón',         emoji: '🥊', threshold: 1e6,        f2pHours: 7.0,  floorBudget: 1e7 },
    { index: 3, key: 'driver', name: 'Corredor',      emoji: '🚗', threshold: 1e9,        f2pHours: 7.5,  floorBudget: 1e10 },
    { index: 4, key: 'capo',   name: 'Capo',          emoji: '🕴️', threshold: 1e12,       f2pHours: 8.0,  floorBudget: 1e13 },
    { index: 5, key: 'godfather', name: 'Padrino',    emoji: '🎩', threshold: 1e15,       f2pHours: 9.0,  floorBudget: 1e16 },
    { index: 6, key: 'legend', name: 'Leyenda Neón',  emoji: '🌆', threshold: 1e18,       f2pHours: 10.0, floorBudget: 1e19 },
    { index: 7, key: 'kingpin', name: 'Dueño de Vice', emoji: '👑', threshold: 1e21,      f2pHours: 12.0, floorBudget: 1e22 }
  ];

  // El rango que abre los retiros (debe coincidir con DATA.SWAP.minRankIndex)
  var SWAP_MIN_RANK = 3;

  // VIP = F2P × 4/3
  var VIP_MULT = 4 / 3;

  // Al agotar el presupuesto diario, goteo del 10 % de la renta.
  var TRICKLE = 0.10;

  // Combo: encadenar clics / acciones. Máximo ×2, decae en 4 s.
  var COMBO_MAX = 2.0;
  var COMBO_WINDOW_MS = 4000;
  var COMBO_STEP = 0.02; // +2 % por acción encadenada

  // Calor policial: sube con cada acción, baja sola. 100 = redada (pierde 25 % del banco).
  var HEAT_MAX = 100;
  var HEAT_PER_ACTION = 0.55;
  var HEAT_COOL_PER_S = 1.6;
  var HEAT_RAID_LOSS = 0.25;

  // Rango de compra de mejoras: cada nivel multiplica el precio ×growth
  var UPGRADE_GROWTH = 1.15;

  // Prestigio: al reiniciar se gana "Estilo" = sqrt(totalEarned / 1e9), mínimo 1.
  var PRESTIGE_DIV = 1e9;

  /* ---------- helpers numéricos ---------- */

  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  function safe(n) { return (typeof n === 'number' && isFinite(n)) ? n : 0; }

  /** Redondeo a 6 decimales para evitar basura de coma flotante en G$. */
  function round6(n) { return Math.round(safe(n) * 1e6) / 1e6; }

  /* ---------- rangos ---------- */

  /** Devuelve el índice de rango (0..7) para un totalEarned dado. Nunca baja. */
  function rankIndexFor(totalEarned) {
    var t = safe(totalEarned), idx = 0;
    for (var i = 0; i < RANKS.length; i++) if (t >= RANKS[i].threshold) idx = i;
    return idx;
  }

  function rankFor(totalEarned) { return RANKS[rankIndexFor(totalEarned)]; }

  /** Horas de juego diario (presupuesto) para rango y condición VIP. */
  function dailyHoursFor(rankIndex, isVip) {
    var r = RANKS[clamp(rankIndex | 0, 0, RANKS.length - 1)];
    return isVip ? r.f2pHours * VIP_MULT : r.f2pHours;
  }

  /**
   * Presupuesto de producción diario = max(suelo_rango, renta/s × horas × 3600).
   * rentaPerSec: G$ por segundo que produce el imperio ahora mismo.
   */
  function dailyBudget(rankIndex, rentaPerSec, isVip) {
    var r = RANKS[clamp(rankIndex | 0, 0, RANKS.length - 1)];
    var hours = dailyHoursFor(rankIndex, isVip);
    var variable = safe(rentaPerSec) * hours * 3600;
    return Math.max(r.floorBudget, variable);
  }

  /* ---------- prestigio ---------- */

  function prestigePoints(totalEarned) {
    var t = safe(totalEarned);
    if (t < PRESTIGE_DIV) return 0;
    return Math.max(1, Math.floor(Math.sqrt(t / PRESTIGE_DIV)));
  }

  /** Multiplicador permanente por estilo (prestigio): +5 % por punto, tope ×5. */
  function prestigeMultiplier(style) {
    return clamp(1 + safe(style) * 0.05, 1, 5);
  }

  /* ---------- mejoras y negocios ---------- */

  /** Coste de la siguiente unidad/nivel: base × growth^nivel. */
  function upgradeCost(baseCost, owned, growth) {
    var g = growth || UPGRADE_GROWTH;
    return Math.ceil(safe(baseCost) * Math.pow(g, Math.max(0, owned | 0)));
  }

  /** Coste total de comprar `qty` niveles empezando en `owned`. */
  function bulkCost(baseCost, owned, qty, growth) {
    var total = 0, o = Math.max(0, owned | 0);
    for (var i = 0; i < (qty | 0); i++) total += upgradeCost(baseCost, o + i, growth);
    return total;
  }

  /** Cuántas unidades se pueden pagar con `money` a partir de `owned`. */
  function affordableCount(baseCost, owned, money, growth) {
    var g = growth || UPGRADE_GROWTH, o = Math.max(0, owned | 0), left = safe(money), n = 0;
    // coste geométrico: base * g^o * (g^n - 1)/(g - 1)
    if (g <= 1) return left >= upgradeCost(baseCost, o, g) ? 1 : 0;
    var first = upgradeCost(baseCost, o, g);
    if (left < first) return 0;
    var ratio = left * (g - 1) / first + 1;      // g^n <= ratio
    var est = Math.floor(Math.log(ratio) / Math.log(g));
    // corrige por redondeos al alza
    while (est > 0 && bulkCost(baseCost, o, est, g) > left) est--;
    while (bulkCost(baseCost, o, est + 1, g) <= left) est++;
    return Math.max(0, est);
  }

  /* ---------- tick de renta ---------- */

  /**
   * Ganancias de un tick.
   * @param {number} rentaPerSec renta nominal del imperio (G$/s)
   * @param {number} seconds segundos transcurridos (limitado por el llamador)
   * @param {object} opts { budgetLeft, combo, heat, prestigeMult, vipMult }
   * @returns {object} { gross, paid, dripped, budgetLeft, raid }
   *
   * - gross  = renta × s × multiplicadores
   * - paid   = min(gross, budgetLeft)
   * - dripped= (gross - paid) × 10 %  (goteo cuando no hay presupuesto)
   */
  function tickGain(rentaPerSec, seconds, opts) {
    var o = opts || {};
    var s = Math.max(0, safe(seconds));
    var combo = clamp(safe(o.combo) || 1, 1, COMBO_MAX);
    var heatMul = 1 - clamp(safe(o.heat), 0, HEAT_MAX) / HEAT_MAX * 0.5; // hasta −50 %
    var prest = clamp(safe(o.prestigeMult) || 1, 1, 5);
    var vip = safe(o.vipMult) || 1;

    var gross = safe(rentaPerSec) * s * combo * Math.max(0.5, heatMul) * prest * vip;
    var budgetLeft = o.budgetLeft;
    var paid, dripped = 0;

    if (typeof budgetLeft === 'number' && isFinite(budgetLeft)) {
      if (budgetLeft <= 0) { paid = gross * TRICKLE; dripped = paid; }
      else if (gross <= budgetLeft) { paid = gross; }
      else { paid = budgetLeft + (gross - budgetLeft) * TRICKLE; dripped = gross - budgetLeft; }
    } else {
      paid = gross;
    }
    return {
      gross: round6(gross),
      paid: round6(paid),
      dripped: round6(dripped),
      budgetLeft: typeof budgetLeft === 'number' ? Math.max(0, round6(budgetLeft - paid)) : undefined,
      heatMul: heatMul
    };
  }

  /* ---------- calor policial ---------- */

  function heatAfter(heat, actions, seconds) {
    var h = safe(heat) + safe(actions) * HEAT_PER_ACTION - safe(seconds) * HEAT_COOL_PER_S;
    return clamp(h, 0, HEAT_MAX);
  }

  /** ¿Se dispara redada al llegar a 100? Devuelve el importe del golpe. */
  function raidLoss(bank, heat) {
    if (safe(heat) < HEAT_MAX) return 0;
    return round6(safe(bank) * HEAT_RAID_LOSS);
  }

  /* ---------- combo ---------- */

  function comboAfter(combo, msSinceLast) {
    if (safe(msSinceLast) > COMBO_WINDOW_MS) return 1;
    return clamp(safe(combo) + COMBO_STEP, 1, COMBO_MAX);
  }

  /* ---------- cambio G$ → USDT (espejo exacto de DATA.SWAP) ---------- */

  /**
   * Convierte G$ a USDT con la tasa de la época y aplica mínimos/topes.
   * @param {object} p { greed, rate, minUsdt, dailyCapUsdt, usedTodayUsdt }
   * @returns {object} { ok, usdt, reason }
   */
  function quoteSwap(p) {
    var rate = safe(p.rate), greed = safe(p.greed);
    if (!(rate > 0)) return { ok: false, usdt: 0, reason: 'no_rate' };
    var usdt = greed / rate;
    var minUsdt = safe(p.minUsdt);
    if (usdt < minUsdt) return { ok: false, usdt: round6(usdt), reason: 'below_min' };
    var left = safe(p.dailyCapUsdt) - safe(p.usedTodayUsdt);
    if (left <= 0) return { ok: false, usdt: round6(usdt), reason: 'player_cap' };
    if (usdt > left) usdt = left;
    return { ok: true, usdt: Math.floor(usdt * 1e6) / 1e6, reason: 'ok' };
  }

  /**
   * Presupuesto de swaps sostenible: globalDailyCap ≤ 0.5 × 30 % × ingresos VIP/30.
   * Devuelve cuántos pases VIP activos hacen falta para sostener un tope dado.
   */
  function vipsNeededForCap(globalDailyCapUsdt, avgPlanUsdt, avgPlanDays) {
    var poolShare = 0.30, margin = 0.5;
    var perPassPerDay = safe(avgPlanUsdt) / Math.max(1, safe(avgPlanDays));
    if (perPassPerDay <= 0) return Infinity;
    return safe(globalDailyCapUsdt) / (perPassPerDay * poolShare * margin);
  }

  /* ---------- export ---------- */

  var Economy = {
    RANKS: RANKS,
    SWAP_MIN_RANK: SWAP_MIN_RANK,
    VIP_MULT: VIP_MULT,
    TRICKLE: TRICKLE,
    COMBO_MAX: COMBO_MAX,
    COMBO_WINDOW_MS: COMBO_WINDOW_MS,
    HEAT_MAX: HEAT_MAX,
    HEAT_PER_ACTION: HEAT_PER_ACTION,
    HEAT_COOL_PER_S: HEAT_COOL_PER_S,
    HEAT_RAID_LOSS: HEAT_RAID_LOSS,
    UPGRADE_GROWTH: UPGRADE_GROWTH,
    PRESTIGE_DIV: PRESTIGE_DIV,
    clamp: clamp,
    round6: round6,
    rankIndexFor: rankIndexFor,
    rankFor: rankFor,
    dailyHoursFor: dailyHoursFor,
    dailyBudget: dailyBudget,
    prestigePoints: prestigePoints,
    prestigeMultiplier: prestigeMultiplier,
    upgradeCost: upgradeCost,
    bulkCost: bulkCost,
    affordableCount: affordableCount,
    tickGain: tickGain,
    heatAfter: heatAfter,
    raidLoss: raidLoss,
    comboAfter: comboAfter,
    quoteSwap: quoteSwap,
    vipsNeededForCap: vipsNeededForCap
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Economy;
  root.Economy = Economy;
})(typeof window !== 'undefined' ? window : globalThis);
