/* =====================================================================
 * VICE IDLE · NEON EMPIRE — js/core.js
 * Estado del juego, tick principal, presupuesto diario, guardado por
 * jugador y migración de partidas. No toca el DOM.
 * ===================================================================== */
(function (root) {
  'use strict';

  var D = root.DATA;
  var E = root.Economy;

  var SAVE_PREFIX = 'viceIdle_save_v1';
  var SAVE_VERSION = 1;
  var AUTOSAVE_MS = 10000;
  var TICK_MS = 250;

  /* ---------------- almacenamiento con espejo en memoria ---------------- */
  var memory = {};
  var storageOk = (function () {
    try {
      var k = '__vice_probe__';
      root.localStorage.setItem(k, '1');
      root.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function lsGet(k) {
    if (storageOk) {
      try { return root.localStorage.getItem(k); } catch (e) { /* cae al espejo */ }
    }
    return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null;
  }
  function lsSet(k, v) {
    memory[k] = v;
    if (storageOk) { try { root.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    return false;
  }
  function lsDel(k) {
    delete memory[k];
    if (storageOk) { try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  }

  /* ---------------- utilidades de fecha ---------------- */
  function utcDay(ts) { var d = new Date(ts || Date.now()); return d.toISOString().slice(0, 10); }
  function utcDayStart(ts) {
    var d = new Date(ts || Date.now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function utcDayEnd(ts) { return utcDayStart(ts) + 86400000; }
  function daysBetweenUTC(d1, d2) {
    var a = Date.parse(d1 + 'T00:00:00Z'), b = Date.parse(d2 + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
  }

  /* ---------------- estado ---------------- */
  var state = null;
  var player = null;
  var listeners = { tick: [], change: [], rankUp: [], raid: [], save: [] };

  function defaultState(name) {
    var now = Date.now();
    return {
      version: SAVE_VERSION,
      game: D.version,
      player: name || 'guest',
      createdAt: now,
      lastSeen: now,
      // economía
      cash: 0,
      totalEarned: 0,
      totalSpent: 0,
      style: 0,
      prestiges: 0,
      // contenido
      businesses: {},        // id -> unidades
      upgrades: {},          // id -> nivel
      // medidores
      heat: 0,
      combo: 1,
      lastActionAt: 0,
      clicks: 0,
      // presupuesto
      budget: null,          // { day: 'YYYY-MM-DD', left: number, total: number }
      // diaria
      daily: { lastDay: null, streak: 0 },
      // misiones
      missions: { day: null, list: [], progress: {}, claimed: {} },
      // logros
      achievements: {},
      // contadores de métricas
      counters: {
        businesses: 0, upgrades: 0, swaps: 0, vipBought: 0,
        missionsDone: 0, raids: 0, events: 0
      },
      // nube
      cloud: { playerId: null, lastSync: 0, enabled: false },
      // preferencias
      prefs: {
        sound: true, music: false, particles: true, reducedMotion: false,
        skin: 's_default', title: 't_none', tipsHidden: false, tab: 'empire'
      },
      // referidos (cosmético)
      referrals: 0,
      referralCode: null,
      // swap (resumen local; el detalle vive en Exchange)
      swapUsed: {},
      // eventos
      event: null,
      lastEventAt: 0,
      // migración
      migratedFrom: null
    };
  }

  /* ---------------- estado derivado ---------------- */
  function bizCount(id) { return (state && state.businesses[id]) || 0; }

  function isVip() {
    if (!state || !state.vipUntil) return false;
    return state.vipUntil > Date.now();
  }

  function vipMultiplier() { return isVip() ? D.vip.incomeMultiplier : 1; }

  function upgradeLevel(id) { return (state && state.upgrades[id]) || 0; }

  function upgradeMul(kind, target) {
    var mul = 1;
    for (var i = 0; i < D.upgrades.length; i++) {
      var u = D.upgrades[i];
      if (u.kind !== kind) continue;
      if (target && u.target !== target) continue;
      var lvl = upgradeLevel(u.id);
      if (!lvl) continue;
      if (kind === 'global' || kind === 'business') mul *= Math.pow(u.effect, lvl);
      if (kind === 'click') mul *= Math.pow(u.effect, lvl);
    }
    return mul;
  }

  function heatReduction() {
    // cleanBooks 0.85^n, lawyer 0.75^n (multiplicativo)
    var m = 1;
    for (var i = 0; i < D.upgrades.length; i++) {
      var u = D.upgrades[i];
      if (u.kind !== 'heat') continue;
      var lvl = upgradeLevel(u.id);
      if (lvl) m *= Math.pow(u.effect, lvl);
    }
    if (isVip()) m *= D.vip.heatPerActionMultiplier;
    return m;
  }

  function budgetBoost() {
    var m = 1;
    for (var i = 0; i < D.upgrades.length; i++) {
      var u = D.upgrades[i];
      if (u.kind !== 'budget') continue;
      var lvl = upgradeLevel(u.id);
      if (lvl) m *= Math.pow(u.effect, lvl);
    }
    return m;
  }

  /** Renta nominal (G$/s) sin multiplicadores temporales. */
  function rentaPerSec() {
    var sum = 0;
    if (!state) return 0;
    for (var i = 0; i < D.businesses.length; i++) {
      var b = D.businesses[i];
      var n = bizCount(b.id);
      if (!n) continue;
      var bizMul = upgradeMul('business', b.id);
      sum += n * b.baseIncome * bizMul;
    }
    sum *= upgradeMul('global');
    sum *= E.prestigeMultiplier(state.style);
    sum *= vipMultiplier();
    return sum;
  }

  /** Renta efectiva tras calor y evento (lo que se ve en el HUD). */
  function effectiveRenta() {
    var r = rentaPerSec();
    var heatMul = 1 - E.clamp(state.heat, 0, E.HEAT_MAX) / E.HEAT_MAX * 0.5;
    var ev = eventMultiplier();
    return r * Math.max(0.5, heatMul) * ev;
  }

  function eventMultiplier() {
    if (!state || !state.event) return 1;
    if (state.event.endsAt <= Date.now()) return 1;
    return state.event.multiplier || 1;
  }

  function clickPower() {
    var base = D.clickBase;
    base *= Math.max(1, rentaPerSec() * 0.02);      // el clic escala con la renta
    base *= upgradeMul('click');
    base *= E.prestigeMultiplier(state.style);
    base *= vipMultiplier();
    return base;
  }

  function rankIndex() { return E.rankIndexFor(state ? state.totalEarned : 0); }
  function rank() { return E.RANKS[rankIndex()]; }

  function budgetTotal() {
    if (!state) return 0;
    return E.dailyBudget(rankIndex(), rentaPerSec(), isVip()) * budgetBoost();
  }

  /* ---------------- inicialización / carga ---------------- */
  function saveKey(name) { return SAVE_PREFIX + '::' + (name || (player && player.name) || 'guest'); }

  function bootstrap(name, opts) {
    player = Object.assign({ name: name || 'guest', guest: !name }, opts || {});
    var raw = lsGet(saveKey(player.name));
    var loaded = null;
    if (raw) {
      try { loaded = JSON.parse(raw); } catch (e) { loaded = null; }
    }
    state = migrate(loaded, player.name);
    ensureToday();
    // deja la ranura creada desde el primer momento (una por jugador)
    if (!raw) lsSet(saveKey(player.name), JSON.stringify(state));
    return state;
  }

  /** Migración de partidas antiguas / campos que falten. */
  function migrate(old, name) {
    var fresh = defaultState(name);
    if (!old || typeof old !== 'object') return fresh;
    var s = Object.assign(fresh, old);
    // campos anidados
    s.prefs = Object.assign(fresh.prefs, old.prefs || {});
    s.counters = Object.assign(fresh.counters, old.counters || {});
    s.daily = Object.assign(fresh.daily, old.daily || {});
    s.cloud = Object.assign(fresh.cloud, old.cloud || {});
    s.missions = Object.assign(fresh.missions, old.missions || {});
    s.businesses = Object.assign({}, old.businesses || {});
    s.upgrades = Object.assign({}, old.upgrades || {});
    s.achievements = Object.assign({}, old.achievements || {});
    s.swapUsed = Object.assign({}, old.swapUsed || {});
    // saneado numérico
    ['cash', 'totalEarned', 'totalSpent', 'style', 'heat', 'combo', 'clicks'].forEach(function (k) {
      if (typeof s[k] !== 'number' || !isFinite(s[k]) || s[k] < 0) s[k] = 0;
    });
    if (s.combo < 1) s.combo = 1;
    if (!s.budget || typeof s.budget.left !== 'number') s.budget = null;
    if (old.version !== SAVE_VERSION) s.migratedFrom = old.version || 0;
    s.version = SAVE_VERSION;
    s.game = D.version;
    return s;
  }

  /* ---------------- día UTC: presupuesto, misiones ---------------- */
  function ensureBudget() {
    var today = utcDay();
    if (!state.budget || state.budget.day !== today) {
      var total = budgetTotal();
      state.budget = { day: today, left: total, total: total };
      emit('change', 'budget-new');
    }
    return state.budget;
  }

  function ensureToday() {
    var today = utcDay();
    if (!state.missions.day || state.missions.day !== today) {
      state.missions = { day: today, list: rollMissions(today), progress: {}, claimed: {} };
      emit('change', 'missions-new');
    }
    ensureBudget();
    // diaria: si pasaron más de 2 días, la racha se rompe
    if (state.daily.lastDay) {
      var gap = daysBetweenUTC(state.daily.lastDay, today);
      if (gap > 1) state.daily.streak = 0;
    }
    // bonus de presupuesto por mejora cambia: solo si el total sube, ajustamos el techo del día
    var total = budgetTotal();
    if (state.budget && total > state.budget.total) {
      state.budget.left += (total - state.budget.total);
      state.budget.total = total;
    }
    return today;
  }

  /** Sortea 3 misiones deterministas por fecha (mismas para todos) con semilla del día. */
  function rollMissions(day) {
    var seed = 0;
    for (var i = 0; i < day.length; i++) seed = (seed * 31 + day.charCodeAt(i)) >>> 0;
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    var pool = D.missions.slice();
    var out = [];
    var n = Math.min(D.missionsPerDay, pool.length);
    for (var j = 0; j < n; j++) {
      var idx = Math.floor(rnd() * pool.length);
      out.push(pool.splice(idx, 1)[0].id);
    }
    return out;
  }

  /* ---------------- acciones ---------------- */

  /** Clic manual: suma dinero, calor y combo. Devuelve el importe. */
  function tap(now) {
    var t = now || Date.now();
    var gain0 = clickPower();
    var combo = E.comboAfter(state.combo, t - (state.lastActionAt || 0));
    state.combo = combo;
    state.lastActionAt = t;
    var gain = E.round6(gain0 * combo);
    state.cash += gain;
    state.totalEarned += gain;
    state.clicks++;
    addHeat(1);
    bump('clicks', 1);
    return gain;
  }

  function addHeat(actions) {
    var prev = state.heat;
    var delta = E.HEAT_PER_ACTION * actions * heatReduction();
    state.heat = E.clamp(prev + delta, 0, E.HEAT_MAX);
    if (state.heat >= E.HEAT_MAX && prev < E.HEAT_MAX) {
      var loss = E.round6(state.cash * E.HEAT_RAID_LOSS);
      state.cash = Math.max(0, state.cash - loss);
      state.counters.raids = (state.counters.raids || 0) + 1;
      state.heat = E.HEAT_MAX * 0.5; // sale de la redada a medio calor
      emit('raid', loss);
    }
  }

  /** Compra unidades de un negocio. mode: '1' | '10' | 'max' */
  function buyBusiness(id, mode) {
    var b = D.businesses.filter(function (x) { return x.id === id; })[0];
    if (!b) return { ok: false, reason: 'not_found' };
    if (b.unlockRank > rankIndex()) return { ok: false, reason: 'locked' };
    var owned = bizCount(id);
    var qty = mode === 'max' ? E.affordableCount(b.baseCost, owned, state.cash, b.growth)
            : (mode === '10' ? 10 : 1);
    if (qty <= 0) return { ok: false, reason: 'cash' };
    var cost = E.bulkCost(b.baseCost, owned, qty, b.growth);
    if (cost > state.cash) {
      qty = E.affordableCount(b.baseCost, owned, state.cash, b.growth);
      if (qty <= 0) return { ok: false, reason: 'cash' };
      cost = E.bulkCost(b.baseCost, owned, qty, b.growth);
    }
    state.cash -= cost;
    state.totalSpent += cost;
    state.businesses[id] = owned + qty;
    state.counters.businesses = (state.counters.businesses || 0) + qty;
    bump('buy', qty);
    addHeat(0.4 * Math.min(qty, 10));
    checkAchievements();
    emit('change', 'buy');
    return { ok: true, qty: qty, cost: cost };
  }

  function buyUpgrade(id) {
    var u = D.upgrades.filter(function (x) { return x.id === id; })[0];
    if (!u) return { ok: false, reason: 'not_found' };
    var lvl = upgradeLevel(id);
    if (lvl >= u.maxLevel) return { ok: false, reason: 'maxed' };
    var cost = E.upgradeCost(u.baseCost, lvl, u.growth);
    if (cost > state.cash) return { ok: false, reason: 'cash' };
    state.cash -= cost;
    state.totalSpent += cost;
    state.upgrades[id] = lvl + 1;
    state.counters.upgrades = (state.counters.upgrades || 0) + 1;
    bump('upgrade', 1);
    checkAchievements();
    emit('change', 'upgrade');
    return { ok: true, cost: cost, level: lvl + 1 };
  }

  /** Reclama una misión completada. No consume presupuesto. */
  function claimMission(id) {
    if (state.missions.claimed[id]) return { ok: false, reason: 'claimed' };
    var m = D.missions.filter(function (x) { return x.id === id; })[0];
    if (!m) return { ok: false, reason: 'not_found' };
    if ((state.missions.progress[id] || 0) < m.target) return { ok: false, reason: 'incomplete' };
    state.missions.claimed[id] = true;
    state.cash += m.reward;
    state.totalEarned += m.reward;
    state.counters.missionsDone = (state.counters.missionsDone || 0) + 1;
    checkAchievements();
    emit('change', 'mission');
    return { ok: true, reward: m.reward };
  }

  function missionProgress(id) {
    var m = D.missions.filter(function (x) { return x.id === id; })[0];
    if (!m) return 0;
    return state.missions.progress[id] || 0;
  }

  /** Actualiza el progreso de las misiones del día. */
  function bump(type, amount) {
    if (!state.missions || !state.missions.list) return;
    var p = state.missions.progress;
    state.missions.list.forEach(function (id) {
      var m = D.missions.filter(function (x) { return x.id === id; })[0];
      if (!m || m.type !== type) return;
      p[id] = (p[id] || 0) + amount;
    });
    // tipos "instantáneos": heat y combo se miden por máximo alcanzado
    if (type === 'clicks') p.__max = 0;
  }

  function checkMissionMeters() {
    if (!state.missions || !state.missions.list) return;
    var p = state.missions.progress;
    state.missions.list.forEach(function (id) {
      var m = D.missions.filter(function (x) { return x.id === id; })[0];
      if (!m) return;
      if (m.type === 'heat') p[id] = Math.max(p[id] || 0, state.heat);
      if (m.type === 'combo') p[id] = Math.max(p[id] || 0, state.combo);
    });
  }

  /** Diaria. Devuelve la recompensa o null. */
  function claimDaily(now) {
    var today = utcDay(now);
    if (state.daily.lastDay === today) return { ok: false, reason: 'already' };
    var gap = state.daily.lastDay ? daysBetweenUTC(state.daily.lastDay, today) : 99;
    var streak = gap === 1 ? Math.min(D.daily.streakCap, (state.daily.streak || 0) + 1) : 1;
    var mult = 1 + D.daily.streakStep * (streak - 1);
    var reward = Math.round(D.daily.baseReward * mult * E.prestigeMultiplier(state.style));
    state.daily.lastDay = today;
    state.daily.streak = streak;
    state.cash += reward;
    state.totalEarned += reward;
    checkAchievements();
    emit('change', 'daily');
    return { ok: true, reward: reward, streak: streak };
  }

  function dailyAvailable(now) {
    var today = utcDay(now);
    if (state.daily.lastDay === today) return false;
    var online = ((now || Date.now()) - state.createdAt) > D.daily.minSecondsOnline * 1000;
    return online || state.daily.lastDay !== null;
  }

  /** Logros: comprueba métricas y devuelve los nuevos. */
  function checkAchievements() {
    var got = [];
    D.achievements.forEach(function (a) {
      if (state.achievements[a.id]) return;
      var v = 0;
      switch (a.metric) {
        case 'clicks': v = state.clicks; break;
        case 'businesses': v = state.counters.businesses || 0; break;
        case 'rank': v = rankIndex(); break;
        case 'totalEarned': v = state.totalEarned; break;
        case 'swaps': v = state.counters.swaps || 0; break;
        case 'vipBought': v = state.counters.vipBought || 0; break;
        case 'prestiges': v = state.prestiges || 0; break;
        case 'dailyStreak': v = state.daily.streak || 0; break;
        case 'missionsDone': v = state.counters.missionsDone || 0; break;
      }
      if (v >= a.target) {
        state.achievements[a.id] = Date.now();
        got.push(a.id);
      }
    });
    return got;
  }

  /** Prestigio */
  function prestige() {
    var pts = E.prestigePoints(state.totalEarned);
    if (!pts) return { ok: false, reason: 'earn' };
    var keep = {
      style: (state.style || 0) + pts,
      prestiges: (state.prestiges || 0) + 1,
      achievements: state.achievements,
      prefs: state.prefs,
      cloud: state.cloud,
      counters: state.counters,
      referrals: state.referrals,
      referralCode: state.referralCode,
      daily: state.daily,
      swapUsed: {},
      createdAt: state.createdAt
    };
    var name = player.name;
    state = defaultState(name);
    Object.assign(state, keep);
    ensureToday();
    checkAchievements();
    emit('change', 'prestige');
    return { ok: true, points: pts, multiplier: E.prestigeMultiplier(state.style) };
  }

  /* ---------------- tick ---------------- */
  var lastTick = 0;
  var lastSaveAt = 0;
  var offlineReport = null;

  /**
   * Avanza la simulación `seconds` (limitado a maxTickSeconds por tick).
   * Devuelve el resultado del tick.
   */
  function tick(realMs) {
    var now = Date.now();
    var dt = Math.min((realMs || (now - lastTick) || TICK_MS) / 1000, D.maxTickSeconds);
    lastTick = now;
    ensureToday();
    var res = E.tickGain(rentaPerSec() * Math.max(0.5, 1 - state.heat / E.HEAT_MAX * 0.5) * eventMultiplier(),
      dt, { budgetLeft: state.budget.left, combo: 1, heat: 0 });
    state.cash += res.paid;
    state.totalEarned += res.paid;
    state.budget.left = res.budgetLeft;
    // enfriamiento del calor
    state.heat = E.clamp(state.heat - E.HEAT_COOL_PER_S * dt, 0, E.HEAT_MAX);
    // combo decae
    if (now - (state.lastActionAt || 0) > E.COMBO_WINDOW_MS) state.combo = 1;
    checkMissionMeters();
    var newAch = checkAchievements();
    emit('tick', { dt: dt, gain: res.paid, ach: newAch });
    return res;
  }

  /** Ganancias offline al arrancar (máximo 12 h, siempre con presupuesto). */
  function applyOffline(now) {
    var ts = now || Date.now();
    var elapsed = Math.max(0, ts - (state.lastSeen || ts));
    if (elapsed < 30000) return null;
    var hours = state.prefs && isVip() ? D.vip.offlineCapHours : D.maxOfflineHours;
    var capped = Math.min(elapsed, hours * 3600 * 1000) / 1000;
    ensureToday();
    var res = E.tickGain(rentaPerSec(), capped, { budgetLeft: state.budget.left, heat: 0 });
    state.cash += res.paid;
    state.totalEarned += res.paid;
    state.budget.left = res.budgetLeft;
    state.lastSeen = ts;
    offlineReport = { seconds: capped, gained: res.paid, real: elapsed / 1000 };
    if (res.paid > 0) emit('change', 'offline');
    return offlineReport;
  }

  function takeOfflineReport() { var r = offlineReport; offlineReport = null; return r; }

  /* ---------------- guardado ---------------- */
  function toSave() {
    var copy = JSON.parse(JSON.stringify(state));
    copy.lastSeen = Date.now();
    return copy;
  }

  function save(reason) {
    if (!state) return false;
    var ok = lsSet(saveKey(), JSON.stringify(toSave()));
    lastSaveAt = Date.now();
    emit('save', { ok: ok, reason: reason || 'auto' });
    return ok;
  }

  function load(name, opts) { return bootstrap(name, opts); }

  function reset(keepStyle) {
    var style = keepStyle ? state.style : 0;
    var name = player.name;
    state = defaultState(name);
    state.style = style;
    ensureToday();
    save('reset');
    emit('change', 'reset');
    return state;
  }

  function exportSave() { return JSON.stringify(toSave(), null, 2); }

  function importSave(json) {
    var obj;
    try { obj = JSON.parse(json); } catch (e) { return { ok: false, reason: 'parse' }; }
    if (!obj || typeof obj !== 'object' || typeof obj.cash !== 'number') return { ok: false, reason: 'shape' };
    state = migrate(obj, player.name);
    ensureToday();
    save('import');
    emit('change', 'import');
    return { ok: true };
  }

  /* ---------------- eventos ---------------- */
  function on(evt, fn) {
    if (!listeners[evt]) listeners[evt] = [];
    listeners[evt].push(fn);
    return function off() { var i = listeners[evt].indexOf(fn); if (i >= 0) listeners[evt].splice(i, 1); };
  }

  function emit(evt, payload) {
    var l = listeners[evt];
    if (!l) return;
    for (var i = 0; i < l.length; i++) {
      try { l[i](payload); } catch (e) { if (root.console) console.error('[core] listener', evt, e); }
    }
  }

  /* ---------------- export ---------------- */
  var Core = {
    SAVE_PREFIX: SAVE_PREFIX,
    SAVE_VERSION: SAVE_VERSION,
    TICK_MS: TICK_MS,
    get state() { return state; },
    get player() { return player; },
    storageOk: storageOk,
    saveKey: saveKey,
    // ciclo
    bootstrap: bootstrap,
    load: load,
    save: save,
    reset: reset,
    exportSave: exportSave,
    importSave: importSave,
    tick: tick,
    applyOffline: applyOffline,
    takeOfflineReport: takeOfflineReport,
    // consultas
    rentaPerSec: rentaPerSec,
    effectiveRenta: effectiveRenta,
    clickPower: clickPower,
    rankIndex: rankIndex,
    rank: rank,
    isVip: isVip,
    vipMultiplier: vipMultiplier,
    upgradeLevel: upgradeLevel,
    upgradeMul: upgradeMul,
    heatReduction: heatReduction,
    budgetTotal: budgetTotal,
    budgetBoost: budgetBoost,
    eventMultiplier: eventMultiplier,
    bizCount: bizCount,
    missionProgress: missionProgress,
    dailyAvailable: dailyAvailable,
    checkAchievements: checkAchievements,
    // acciones
    tap: tap,
    addHeat: addHeat,
    buyBusiness: buyBusiness,
    buyUpgrade: buyUpgrade,
    claimMission: claimMission,
    claimDaily: claimDaily,
    prestige: prestige,
    ensureToday: ensureToday,
    ensureBudget: ensureBudget,
    rollMissions: rollMissions,
    // eventos
    on: on,
    emit: emit,
    // fechas
    utcDay: utcDay,
    utcDayStart: utcDayStart,
    utcDayEnd: utcDayEnd,
    daysBetweenUTC: daysBetweenUTC,
    // almacenamiento de bajo nivel (lo usan auth y cloud)
    lsGet: lsGet,
    lsSet: lsSet,
    lsDel: lsDel
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
