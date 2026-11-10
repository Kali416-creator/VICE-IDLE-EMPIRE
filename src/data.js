/* =====================================================================
 * VICE IDLE · NEON EMPIRE — src/data.js
 * Contenido del juego y TODAS las constantes económicas visibles.
 * Los textos viven en i18n.js; aquí solo hay claves + números.
 * ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------- Negocios ----------------
   * baseCost: G$ de la primera unidad
   * baseIncome: G$/s que aporta cada unidad
   * growth: multiplicador de precio por unidad comprada
   * Requiere `unlockRank` para poder comprarse (0 = desde el inicio)
   */
  var BUSINESSES = [
    { id: 'kiosk',      emoji: '🚬', baseCost: 15,      baseIncome: 0.5,      growth: 1.15, unlockRank: 0, adminPerSec: 0.02 },
    { id: 'poker',      emoji: '🎰', baseCost: 300,     baseIncome: 5,        growth: 1.15, unlockRank: 0, adminPerSec: 0.04 },
    { id: 'pharmacy',   emoji: '💊', baseCost: 6e3,     baseIncome: 60,       growth: 1.15, unlockRank: 1, adminPerSec: 0.06 },
    { id: 'scrapyard',  emoji: '🚗', baseCost: 1.2e5,   baseIncome: 800,      growth: 1.15, unlockRank: 1, adminPerSec: 0.08 },
    { id: 'club',       emoji: '🍸', baseCost: 2.5e6,   baseIncome: 1.1e4,    growth: 1.15, unlockRank: 2, adminPerSec: 0.10 },
    { id: 'cryptofarm', emoji: '💻', baseCost: 5e7,     baseIncome: 1.5e5,    growth: 1.15, unlockRank: 2, adminPerSec: 0.12 },
    { id: 'laundry',    emoji: '🏦', baseCost: 1.1e9,   baseIncome: 2.2e6,    growth: 1.15, unlockRank: 3, adminPerSec: 0.14 },
    { id: 'harbor',     emoji: '🛳️', baseCost: 2.5e10,  baseIncome: 3.2e6,    growth: 1.15, unlockRank: 4, adminPerSec: 0.16 },
    { id: 'tower',      emoji: '🏙️', baseCost: 6e11,    baseIncome: 9e8,      growth: 1.15, unlockRank: 5, adminPerSec: 0.18 },
    { id: 'satellite',  emoji: '🛰️', baseCost: 1.5e13,  baseIncome: 1.6e10,   growth: 1.15, unlockRank: 6, adminPerSec: 0.20 }
  ];

  /* ---------------- Mejoras ----------------
   * kind: 'business' (boost a un negocio) | 'global' (toda la renta) | 'click' | 'heat' | 'budget'
   * effect: multiplicador aditivo aplicado (business/global/click) o valor absoluto
   * maxLevel: niveles comprables
   */
  var UPGRADES = [
    { id: 'neonSign',   kind: 'click',    effect: 1.5,  baseCost: 200,     growth: 2.2, maxLevel: 10 },
    { id: 'brassKnuckles', kind: 'click', effect: 2.0,  baseCost: 5e4,     growth: 2.4, maxLevel: 8 },
    { id: 'kioskBoost', kind: 'business', target: 'kiosk',   effect: 1.5, baseCost: 400,    growth: 2.0, maxLevel: 8 },
    { id: 'pokerBoost', kind: 'business', target: 'poker',   effect: 1.5, baseCost: 4.5e3,  growth: 2.0, maxLevel: 8 },
    { id: 'clubBoost',  kind: 'business', target: 'club',    effect: 1.6, baseCost: 8.5e6,  growth: 2.0, maxLevel: 8 },
    { id: 'harborBoost',kind: 'business', target: 'harbor',  effect: 1.6, baseCost: 1.6e10, growth: 2.0, maxLevel: 8 },
    { id: 'cleanBooks', kind: 'heat',     effect: 0.85, baseCost: 3e5,     growth: 2.6, maxLevel: 6 },
    { id: 'lawyer',     kind: 'heat',     effect: 0.75, baseCost: 9e7,     growth: 2.8, maxLevel: 5 },
    { id: 'logistics',  kind: 'global',   effect: 1.10, baseCost: 2.5e4,   growth: 3.0, maxLevel: 12 },
    { id: 'corruption', kind: 'global',   effect: 1.15, baseCost: 7.5e6,   growth: 3.1, maxLevel: 10 },
    { id: 'shellCompanies', kind: 'global', effect: 1.20, baseCost: 4.0e9, growth: 3.2, maxLevel: 10 },
    { id: 'blackBudget', kind: 'budget',  effect: 1.25, baseCost: 2.0e8,   growth: 3.4, maxLevel: 8 }
  ];

  /* ---------------- Misiones diarias ----------------
   * Se sortean 3 al día (determinista por fecha+jugador). NO consumen presupuesto.
   * type: clicks | buy | upgrade | earn | heat | swap | combo | prestige
   */
  var MISSIONS = [
    { id: 'm_clicks_200',   type: 'clicks',   target: 200,  reward: 1500 },
    { id: 'm_clicks_500',   type: 'clicks',   target: 500,  reward: 6000 },
    { id: 'm_buy_10',       type: 'buy',      target: 10,   reward: 2500 },
    { id: 'm_buy_30',       type: 'buy',      target: 30,   reward: 12000 },
    { id: 'm_buy_75',       type: 'buy',      target: 75,   reward: 40000 },
    { id: 'm_upgrade_1',    type: 'upgrade',  target: 1,    reward: 5000 },
    { id: 'm_upgrade_3',    type: 'upgrade',  target: 3,    reward: 18000 },
    { id: 'm_earn_1e4',     type: 'earn',     target: 1e4,  reward: 4000 },
    { id: 'm_earn_1e6',     type: 'earn',     target: 1e6,  reward: 250000 },
    { id: 'm_earn_1e8',     type: 'earn',     target: 1e8,  reward: 2.5e7 },
    { id: 'm_heat_30',      type: 'heat',     target: 30,   reward: 3000 },
    { id: 'm_heat_70',      type: 'heat',     target: 70,   reward: 9000 },
    { id: 'm_combo_15',     type: 'combo',    target: 1.5,  reward: 7000 },
    { id: 'm_combo_max',    type: 'combo',    target: 2.0,  reward: 20000 },
    { id: 'm_swap_1',       type: 'swap',     target: 1,    reward: 5e6 },
    { id: 'm_swap_5',       type: 'swap',     target: 5,    reward: 4e7 },
    { id: 'm_prestige_1',   type: 'prestige', target: 1,    reward: 1e6 },
    { id: 'm_prestige_3',   type: 'prestige', target: 3,    reward: 1e8 },
    { id: 'm_clicks_1500',  type: 'clicks',   target: 1500, reward: 90000 },
    { id: 'm_buy_200',      type: 'buy',      target: 200,  reward: 900000 },
    { id: 'm_upgrade_8',    type: 'upgrade',  target: 8,    reward: 1.2e6 },
    { id: 'm_earn_1e10',    type: 'earn',     target: 1e10, reward: 1.5e9 },
    { id: 'm_heat_100',     type: 'heat',     target: 100,  reward: 25000 },
    { id: 'm_combo_30',     type: 'combo',    target: 1.8,  reward: 15000 }
  ];

  /* ---------------- Diaria ---------------- */
  var DAILY = {
    baseReward: 800,
    streakStep: 0.6,      // +60 % por día de racha
    streakCap: 10,        // la racha cuenta hasta 10
    minSecondsOnline: 60, // hay que estar 1 min para poder reclamarla
    resetUtcHour: 0
  };

  /* ---------------- Prestigio ---------------- */
  var PRESTIGE = {
    div: 1e9,          // Estilo = sqrt(totalEarned / div)
    perPoint: 0.05,    // +5 % por punto
    capMult: 5,        // tope ×5
    minTotalEarned: 1e9 // no se puede prestigiar antes
  };

  /* ---------------- Cambio G$ → USDT ---------------- */
  var SWAP = {
    // Tasa época 1: 1 000 000 G$ = 0.10 USDT  ⟹  10 000 000 G$ = 1 USDT
    epochRate: 10000000,
    epochDays: 14,              // recalibración cada 14 días
    maxRateStepPct: 60,         // paso máximo ±60 %
    minUsdt: 0.10,              // = 1 000 000 G$ con la tasa de la época 1
    playerDailyCapUsdt: 0.20,   // = 2 000 000 G$ con la tasa de la época 1
    globalDailyCapUsdt: 25,
    minRankIndex: 3,            // 🚗 Corredor (10^9 G$ ganados)
    vipSkipsRankGate: true,     // quien tiene VIP activo retira sin rango mínimo
    payoutsPerDay: 1,           // 1 cambio por jugador y día (además del cupo)
    reserveShareBps: 3000       // 30 % de cada VIP va a la reserva del swap
  };

  /* ---------------- VIP ---------------- */
  var VIP = {
    plans: [
      { days: 30, priceUsdt: 12 },
      { days: 60, priceUsdt: 22 },
      { days: 90, priceUsdt: 30 }
    ],
    split: { swapPoolBps: 3000, treasuryBps: 7000, burnBps: 0 },
    incomeMultiplier: 4 / 3,   // VIP = F2P × 4/3
    heatPerActionMultiplier: 0.65,
    offlinCapHours: 12
  };

  /* ---------------- Referidos (SOLO cosmético) ---------------- */
  var COSMETICS = {
    titles: [
      { id: 't_none',    minReferrals: 0,  key: 'title_none' },
      { id: 't_street',  minReferrals: 1,  key: 'title_street' },
      { id: 't_broker',  minReferrals: 3,  key: 'title_broker' },
      { id: 't_boss',    minReferrals: 10, key: 'title_boss' },
      { id: 't_ghost',   minReferrals: 25, key: 'title_ghost' }
    ],
    skins: [
      { id: 's_default', minReferrals: 0, key: 'skin_default' },
      { id: 's_sunset',  minReferrals: 2, key: 'skin_sunset' },
      { id: 's_toxic',   minReferrals: 5, key: 'skin_toxic' },
      { id: 's_gold',    minReferrals: 15, key: 'skin_gold' },
      { id: 's_void',    minReferrals: 40, key: 'skin_void' }
    ],
    badges: [
      { id: 'b_new',    minDays: 0,   key: 'badge_new' },
      { id: 'b_regular',minDays: 7,   key: 'badge_regular' },
      { id: 'b_veteran',minDays: 30,  key: 'badge_veteran' },
      { id: 'b_legend', minDays: 90,  key: 'badge_legend' }
    ]
  };

  /* ---------------- Eventos temporales ---------------- */
  var EVENTS = [
    { id: 'neonRain',   multiplier: 1.25, durationMin: 30, weight: 3, key: 'ev_neon_rain' },
    { id: 'heatWave',   multiplier: 1.40, durationMin: 20, weight: 2, key: 'ev_heat_wave' },
    { id: 'blackMarket',multiplier: 1.60, durationMin: 10, weight: 1, key: 'ev_black_market' }
  ];
  var EVENT_PERIOD_MIN = 45; // se intenta lanzar uno cada ~45 min de juego activo

  /* ---------------- Logros (permanentes, sin efecto económico) ---------------- */
  var ACHIEVEMENTS = [
    { id: 'firstClick',  target: 1,     metric: 'clicks' },
    { id: 'clicks1k',    target: 1000,  metric: 'clicks' },
    { id: 'firstBiz',    target: 1,     metric: 'businesses' },
    { id: 'biz100',      target: 100,   metric: 'businesses' },
    { id: 'rank3',       target: 3,     metric: 'rank' },
    { id: 'rank5',       target: 5,     metric: 'rank' },
    { id: 'rank7',       target: 7,     metric: 'rank' },
    { id: 'earn1e6',     target: 1e6,   metric: 'totalEarned' },
    { id: 'earn1e9',     target: 1e9,   metric: 'totalEarned' },
    { id: 'earn1e15',    target: 1e15,  metric: 'totalEarned' },
    { id: 'firstSwap',   target: 1,     metric: 'swaps' },
    { id: 'vip',         target: 1,     metric: 'vipBought' },
    { id: 'prestige1',   target: 1,     metric: 'prestiges' },
    { id: 'streak7',     target: 7,     metric: 'dailyStreak' },
    { id: 'missions25',  target: 25,    metric: 'missionsDone' }
  ];

  var DATA = {
    version: '4.5.0',
    // base de las épocas del swap: fecha de la v4.6 (tasa 10 000 000 G$ = 1 USDT)
    startedAtUtc: 1794321600,
    businesses: BUSINESSES,
    upgrades: UPGRADES,
    missions: MISSIONS,
    achievements: ACHIEVEMENTS,
    daily: DAILY,
    prestige: PRESTIGE,
    swap: SWAP,
    vip: VIP,
    cosmetics: COSMETICS,
    events: EVENTS,
    eventPeriodMin: EVENT_PERIOD_MIN,
    // límites de simulación
    maxOfflineHours: 12,
    maxTickSeconds: 60,
    clickBase: 1,
    missionsPerDay: 3
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  root.DATA = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
