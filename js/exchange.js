/* =====================================================================
 * VICE IDLE · NEON EMPIRE — js/exchange.js
 * Libro del Cambio G$ → USDT, POR JUGADOR, y referidos (solo cosméticos).
 *
 * Flujo:
 *   Exchange.request(greed)  → estado 'pending' (valida rango/mínimo/cupo)
 *   Exchange.applyVoucher()  → estado 'signed'  (pega el JSON del relayer)
 *   Exchange.claim()         → estado 'claimed' (llama al contrato, vía Chain)
 *   Exchange.reject()        → devuelve G$ y cupo
 *
 * El cliente NUNCA decide un pago: aquí solo se reserva/deducir G$ blandos
 * y se valida el voucher. El USDT lo mueve el contrato.
 * ===================================================================== */
(function (root) {
  'use strict';

  var D = root.DATA;
  var E = root.Economy;
  var BOOK_PREFIX = 'viceIdle_exchange_v2';

  function playerName() {
    return (root.Core && root.Core.player && root.Core.player.name) || 'guest';
  }

  function bookKey(name) { return BOOK_PREFIX + '::' + (name || playerName()); }

  function emptyBook(name) {
    return {
      player: name || playerName(),
      createdAt: Date.now(),
      // pending actual (solo uno a la vez)
      pending: null,
      // historial de cambios
      history: [],
      // consumo por día UTC: { 'YYYY-MM-DD': usdt }
      used: {},
      // referidos (solo cosmético)
      referrals: { code: null, invitedBy: null, count: 0, list: [] }
    };
  }

  function load() {
    var core = root.Core;
    var raw = core && core.lsGet ? core.lsGet(bookKey()) : null;
    if (!raw) return emptyBook();
    try {
      var b = JSON.parse(raw);
      return Object.assign(emptyBook(), b, {
        used: Object.assign({}, b.used || {}),
        referrals: Object.assign(emptyBook().referrals, b.referrals || {})
      });
    } catch (e) { return emptyBook(); }
  }

  function save(book) {
    if (root.Core && root.Core.lsSet) root.Core.lsSet(bookKey(), JSON.stringify(book));
    return book;
  }

  /* ---------------- tasa por épocas ---------------- */

  /**
   * Época actual desde DATA.startedAtUtc, cada `epochDays` días.
   * La tasa se recalibra como máximo ±maxRateStepPct respecto a la anterior;
   * sin señal de mercado (esto es ficción) usa una deriva determinista acotada.
   */
  function epochInfo(now) {
    var t = now || Date.now();
    var elapsedDays = (t / 1000 - D.startedAtUtc) / 86400;
    var epoch = Math.max(1, Math.floor(elapsedDays / D.swap.epochDays) + 1);
    var rate = D.swap.epochRate;
    // Deriva determinista a partir de la época 2 (la 1 es la tasa de diseño).
    // Cada época mueve como máximo ±60 % respecto a la anterior.
    // Deriva determinista y ACOTADA: ±25 % de la tasa base. Sin señal de
    // mercado real (esto es ficción) el tipo no debe alejarse de su diseño.
    if (epoch > 1) {
      var phase = Math.sin(epoch * 0.7) * 0.25;
      rate = Math.round(D.swap.epochRate * (1 + phase));
    }
    var startDay = (epoch - 1) * D.swap.epochDays;
    var startTs = (D.startedAtUtc + startDay * 86400) * 1000;
    var endTs = startTs + D.swap.epochDays * 86400 * 1000;
    return {
      epoch: epoch,
      rate: Math.round(rate),
      startTs: startTs,
      endTs: endTs,
      daysLeft: Math.max(0, Math.ceil((endTs - t) / 86400000)),
      minUsdt: D.swap.minUsdt,
      playerCap: D.swap.playerDailyCapUsdt,
      globalCap: D.swap.globalDailyCapUsdt
    };
  }

  function usedToday(book, now) {
    var day = root.Core ? root.Core.utcDay(now) : new Date(now || Date.now()).toISOString().slice(0, 10);
    var u = book || load();
    return u.used[day] || 0;
  }

  /** ¿Puede el jugador pedir un cambio ahora? Devuelve { ok, reason, detail }. */
  function canRequest(greed, now) {
    var core = root.Core;
    if (!core || !core.state) return { ok: false, reason: 'no_state' };
    var rankIdx = core.rankIndex();
    var vip = core.isVip() && D.swap.vipSkipsRankGate;
    if (rankIdx < D.swap.minRankIndex && !vip) {
      return {
        ok: false, reason: 'needRank', rank: E.RANKS[D.swap.minRankIndex].name,
        need: D.swap.minRankIndex, current: rankIdx, vipBypass: !!D.swap.vipSkipsRankGate
      };
    }
    var ep = epochInfo(now);
    var book = load();
    if (book.pending && (book.pending.status === 'pending' || book.pending.status === 'signed')) {
      return { ok: false, reason: 'pending' };
    }
    // un pending muerto (rechazado/reclamado) no bloquea
    if (book.pending && book.pending.status !== 'pending' && book.pending.status !== 'signed') {
      book.pending = null;
      save(book);
    }
    var used = usedToday(book, now);
    var left = Math.max(0, ep.playerCap - used);
    if (left <= 0) return { ok: false, reason: 'player_cap', cap: ep.playerCap, used: used };
    var q = E.quoteSwap({
      greed: greed, rate: ep.rate, minUsdt: ep.minUsdt,
      dailyCapUsdt: ep.playerCap, usedTodayUsdt: used
    });
    if (!q.ok) return { ok: false, reason: q.reason, usdt: q.usdt };
    if (greed > core.state.cash) return { ok: false, reason: 'cash' };
    return { ok: true, usdt: q.usdt, rate: ep.rate, epoch: ep.epoch, left: left };
  }

  /**
   * Crea la solicitud. Descuenta el G$ (queda en custodia del cambio) y
   * apunta el USDT al cupo del día SOLO al reclamar (no al pedir).
   */
  function request(greedRaw, now) {
    var core = root.Core;
    var greed = Number(String(greedRaw).replace(/[^0-9.]/g, ''));
    if (!isFinite(greed) || greed <= 0) return { ok: false, reason: 'invalid' };
    greed = Math.floor(greed);
    var chk = canRequest(greed, now);
    if (!chk.ok) return chk;
    var book = load();
    var ep = epochInfo(now);
    core.state.cash = Math.max(0, core.state.cash - greed);
    var entry = {
      id: 'sw_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      status: 'pending',
      greed: greed,
      usdt: chk.usdt,
      rate: ep.rate,
      epoch: ep.epoch,
      createdAt: Date.now(),
      wallet: null,
      voucher: null,
      txHash: null,
      day: core.utcDay(now)
    };
    book.pending = entry;
    book.history.unshift(cloneEntry(entry));
    if (book.history.length > 50) book.history.length = 50;
    save(book);
    core.state.counters.swaps = (core.state.counters.swaps || 0) + 1;
    core.checkAchievements();
    core.save('swap-request');
    return { ok: true, entry: entry };
  }

  function cloneEntry(e) {
    return {
      id: e.id, status: e.status, greed: e.greed, usdt: e.usdt, rate: e.rate,
      epoch: e.epoch, createdAt: e.createdAt, wallet: e.wallet, txHash: e.txHash,
      day: e.day, voucherSig: e.voucher ? (e.voucher.signature || '').slice(0, 12) + '…' : null
    };
  }

  function setHistoryStatus(book, id, status, extra) {
    for (var i = 0; i < book.history.length; i++) {
      if (book.history[i].id === id) {
        book.history[i].status = status;
        if (extra) Object.assign(book.history[i], extra);
      }
    }
  }

  /* ---------------- vouchers ---------------- */

  var VOUCHER_FIELDS = ['player', 'greed', 'usdt', 'deadline', 'nonce', 'signature'];

  /** Valida forma y caducidad del voucher pegado por el jugador. */
  function parseVoucher(text, now) {
    var t = now || Date.now();
    var obj;
    if (typeof text === 'object') obj = text;
    else {
      try { obj = JSON.parse(String(text || '').trim()); }
      catch (e) { return { ok: false, reason: 'json' }; }
    }
    if (!obj || typeof obj !== 'object') return { ok: false, reason: 'json' };
    for (var i = 0; i < VOUCHER_FIELDS.length; i++) {
      if (obj[VOUCHER_FIELDS[i]] === undefined || obj[VOUCHER_FIELDS[i]] === null) {
        return { ok: false, reason: 'field', field: VOUCHER_FIELDS[i] };
      }
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(obj.player))) return { ok: false, reason: 'player' };
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(obj.signature))) return { ok: false, reason: 'signature' };
    var greed = Number(obj.greed);
    var usdt = Number(obj.usdt);
    if (!isFinite(greed) || greed <= 0 || !isFinite(usdt) || usdt <= 0) return { ok: false, reason: 'amounts' };
    var deadline = Number(obj.deadline);
    if (!isFinite(deadline)) return { ok: false, reason: 'deadline' };
    if (deadline * 1000 <= t) return { ok: false, reason: 'expired' };
    var nonce = Number(obj.nonce);
    if (!isFinite(nonce) || nonce < 0) return { ok: false, reason: 'nonce' };
    return { ok: true, voucher: { player: obj.player, greed: greed, usdt: usdt, deadline: deadline, nonce: nonce, signature: obj.signature } };
  }

  /**
   * Aplica el voucher al pending. Comprueba que cubra el importe pedido.
   * Devuelve { ok, reason }.
   */
  function applyVoucher(text, now) {
    var core = root.Core;
    var book = load();
    var p = book.pending;
    if (!p || p.status !== 'pending') return { ok: false, reason: 'no_pending' };
    var v = parseVoucher(text, now);
    if (!v.ok) return v;
    if (v.voucher.greed + 1e-6 < p.greed) return { ok: false, reason: 'amount_mismatch' };
    // tolerancia: el voucher no debe prometer mucho más de lo pedido
    if (v.voucher.usdt > p.usdt * 1.02 + 0.001) return { ok: false, reason: 'usdt_mismatch' };
    p.status = 'signed';
    p.voucher = v.voucher;
    p.wallet = v.voucher.player;
    p.signedAt = Date.now();
    setHistoryStatus(book, p.id, 'signed', { wallet: p.wallet, voucherSig: v.voucher.signature.slice(0, 12) + '…' });
    save(book);
    core.save('swap-signed');
    return { ok: true, entry: p };
  }

  /** Marca el pending como reclamado y consume el cupo del día. */
  function markClaimed(txHash, now) {
    var core = root.Core;
    var book = load();
    var p = book.pending;
    if (!p) return { ok: false, reason: 'no_pending' };
    if (p.status !== 'signed') return { ok: false, reason: 'not_signed' };
    var day = core.utcDay(now);
    book.used[day] = (book.used[day] || 0) + p.usdt;
    // limpia días viejos
    Object.keys(book.used).forEach(function (k) {
      if (core.daysBetweenUTC(k, day) > 7) delete book.used[k];
    });
    p.status = 'claimed';
    p.txHash = txHash || null;
    p.claimedAt = Date.now();
    setHistoryStatus(book, p.id, 'claimed', { txHash: p.txHash });
    core.state.counters.swaps = core.state.counters.swaps || 0;
    book.pending = null;
    save(book);
    core.addHeat(3);
    core.save('swap-claimed');
    return { ok: true, entry: p };
  }

  /** Rechaza el pending y devuelve el G$ al jugador. */
  function reject(reason) {
    var core = root.Core;
    var book = load();
    var p = book.pending;
    if (!p) return { ok: false, reason: 'no_pending' };
    if (p.status === 'claimed') return { ok: false, reason: 'claimed' };
    core.state.cash += p.greed;
    p.status = 'rejected';
    p.rejectedAt = Date.now();
    p.rejectReason = reason || 'manual';
    setHistoryStatus(book, p.id, 'rejected', { rejectReason: p.rejectReason });
    // el G$ no se pierde: solo baja el contador de "pedidos" ya contado
    book.pending = null;
    save(book);
    core.save('swap-reject');
    return { ok: true, refunded: p.greed };
  }

  /* ---------------- cupo global (local, informativo) ---------------- */

  /**
   * Cupo global diario. El cliente no puede consultar el estado on-chain
   * sin red; se estima con lo gastado localmente y se deja el control real
   * al contrato (que también lo aplica).
   */
  function globalUsage(now) {
    var core = root.Core;
    if (!core || !core.lsGet) return { used: 0, cap: D.swap.globalDailyCapUsdt, left: D.swap.globalDailyCapUsdt };
    var raw = core.lsGet('viceIdle_global_swap_v1');
    var day = core.utcDay(now);
    var used = 0;
    try {
      var o = raw ? JSON.parse(raw) : null;
      if (o && o.day === day) used = o.used || 0;
    } catch (e) { used = 0; }
    return { used: used, cap: D.swap.globalDailyCapUsdt, left: Math.max(0, D.swap.globalDailyCapUsdt - used) };
  }

  /* ---------------- referidos (SOLO cosmético) ---------------- */

  function makeCode(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    var alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    for (var j = 0; j < 6; j++) { out += alpha[h % alpha.length]; h = Math.floor(h / alpha.length) + 7; }
    return out;
  }

  function ensureReferralCode() {
    var book = load();
    if (!book.referrals.code) {
      book.referrals.code = makeCode(playerName().toUpperCase());
      save(book);
    }
    return book.referrals.code;
  }

  /** Registra un referido. No da NADA económico: solo desbloquea cosméticos. */
  function addReferral(code) {
    var book = load();
    var c = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(c)) return { ok: false, reason: 'invalid' };
    if (book.referrals.invitedBy) return { ok: false, reason: 'already' };
    if (c === book.referrals.code) return { ok: false, reason: 'self' };
    book.referrals.invitedBy = c;
    book.referrals.count = (book.referrals.count || 0) + 1;
    book.referrals.list.push({ code: c, at: Date.now() });
    save(book);
    if (root.Core) root.Core.state.referrals = book.referrals.count;
    return { ok: true, count: book.referrals.count };
  }

  /** Título/insignia/skin desbloqueados por referidos. */
  function unlockedCosmetics() {
    var book = load();
    var n = book.referrals.count || 0;
    var C = D.cosmetics;
    return {
      titles: C.titles.filter(function (t) { return n >= t.minReferrals; }).map(function (t) { return t.id; }),
      skins: C.skins.filter(function (s) { return n >= s.minReferrals; }).map(function (s) { return s.id; }),
      referrals: n
    };
  }

  /* ---------------- puerta de retiros ---------------- */

  /**
   * Estado de la puerta de retiro:
   *   { open, byVip, rankOk, vipBypass, need, current, minRankKey }
   * - `open`  → puede retirar (por rango o por VIP activo)
   * - `byVip` → entra por la excepción VIP (no tenía el rango)
   */
  function gate() {
    var core = root.Core;
    if (!core || !core.state) {
      return { open: false, byVip: false, rankOk: false, vipBypass: false, need: D.swap.minRankIndex, current: 0 };
    }
    var cur = core.rankIndex();
    var rankOk = cur >= D.swap.minRankIndex;
    var vip = !!core.isVip() && !!D.swap.vipSkipsRankGate;
    return {
      open: rankOk || vip,
      byVip: vip && !rankOk,
      rankOk: rankOk,
      vipBypass: !!D.swap.vipSkipsRankGate,
      need: D.swap.minRankIndex,
      current: cur,
      vipUntil: core.state.vipUntil || 0,
      minRankKey: 'rank.name.' + D.swap.minRankIndex
    };
  }

  /* ---------------- resumen para la UI ---------------- */

  function summary(now) {
    var book = load();
    var ep = epochInfo(now);
    return {
      epoch: ep,
      pending: (book.pending && (book.pending.status === 'pending' || book.pending.status === 'signed'))
        ? book.pending : null,
      history: book.history,
      usedToday: usedToday(book, now),
      playerCap: ep.playerCap,
      global: globalUsage(now),
      gate: gate(),
      minGreed: Math.ceil(ep.minUsdt * ep.rate)
    };
  }

  var Exchange = {
    BOOK_PREFIX: BOOK_PREFIX,
    load: load,
    save: save,
    epochInfo: epochInfo,
    usedToday: usedToday,
    canRequest: canRequest,
    request: request,
    parseVoucher: parseVoucher,
    applyVoucher: applyVoucher,
    markClaimed: markClaimed,
    reject: reject,
    globalUsage: globalUsage,
    summary: summary,
    gate: gate,
    ensureReferralCode: ensureReferralCode,
    addReferral: addReferral,
    unlockedCosmetics: unlockedCosmetics,
    makeCode: makeCode,
    bookKey: bookKey,
    // para tests
    _reset: function () {
      var b = emptyBook();
      save(b);
      return b;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Exchange;
  root.Exchange = Exchange;
})(typeof window !== 'undefined' ? window : globalThis);
