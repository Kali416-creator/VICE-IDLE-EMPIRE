/* =====================================================================
 * VICE IDLE · NEON EMPIRE — js/backend.js
 * Cliente del BACKEND del juego (marcador): registra al jugador y sube su balance.
 * La implementación del backend vive en backend/ (fuera del cliente).
 *
 * Reglas:
 *  - Solo una clave pública. Jamás claves de administración.
 *  - Sin conexión configurada, todo devuelve { ok:false } y el juego sigue.
 *  - Es un MARCADOR, no un libro contable: el dinero real lo protege el
 *    contrato (voucher + topes on-chain).
 *  - La tabla `players` no es legible con la anon key: se accede solo por
 *    las funciones RPC `player_sync` y `player_get` (SECURITY DEFINER).
 *  - Los números ≥ 1e21 se envían como string: String(1e21) = "1e+21",
 *    por eso siempre usamos BigInt(n).toString().
 * ===================================================================== */
(function (root) {
  'use strict';

  var CONF_KEY = 'viceIdle_backend_v1';   // { url, key, auto, enabled }
  var AUTO_SYNC_MS = 25000;
  var cache = {};

  /* ---------------- configuración ---------------- */

  function loadConf() {
    var raw = root.Core && root.Core.lsGet ? root.Core.lsGet(CONF_KEY) : null;
    if (!raw) return { url: '', key: '', auto: true, enabled: false };
    try {
      var o = JSON.parse(raw);
      return {
        url: String(o.url || '').replace(/\/+$/, ''),
        key: String(o.key || ''),
        auto: o.auto !== false,
        enabled: !!(o.url && o.key && o.enabled !== false)
      };
    } catch (e) { return { url: '', key: '', auto: true, enabled: false }; }
  }

  function saveConf(c) {
    var rawUrl = String(c.url === undefined || c.url === null ? '' : c.url).trim();
    var clean = {
      // '' se guarda como '.' (mismo origen: el servidor del juego hace de proxy)
      url: (rawUrl === '' || rawUrl === '.') ? '.' : rawUrl.replace(/\/+$/, ''),
      key: String(c.key || '').trim(),
      auto: c.auto !== false,
      enabled: !!c.key
    };
    if (root.Core && root.Core.lsSet) root.Core.lsSet(CONF_KEY, JSON.stringify(clean));
    cache = {};
    return clean;
  }

  function clearConf() {
    if (root.Core && root.Core.lsDel) root.Core.lsDel(CONF_KEY);
    cache = {};
  }

  function configured() {
    var c = loadConf();
    return !!(c.enabled && c.key && (c.url || c.url === '.'));
  }

  /**
   * Comprueba la forma de la configuración del backend:
   *   URL https (sin barra final) + clave de acceso de 8+ caracteres.
   * No se asume ningún proveedor concreto.
   */
  function validateConfig(url, key) {
    var u = String(url || '').trim().replace(/\/+$/, '');
    if (u === '') u = '.'; // mismo origen: el servidor del juego hace de proxy
    // ruta relativa ('.' o '/algo') o URL absoluta http(s)
    if (!/^(\.(\/[^\s]*)?|\/[^\s]*|https?:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?)$/i.test(u)) {
      return { ok: false, reason: 'url' };
    }
    var k = String(key || '').trim();
    if (k.length < 8) return { ok: false, reason: 'key' };
    // una clave de servicio (con permisos de administración) nunca va al cliente
    var parts = k.split('.');
    if (parts.length === 3) {
      try {
        var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        var payload = JSON.parse(atob(b64));
        if (payload && payload.role && payload.role !== 'anon' && payload.role !== 'publishable') {
          return { ok: false, reason: 'role' };
        }
      } catch (e) { /* no es un JWT: vale igual */ }
    }
    return { ok: true, url: u, key: k };
  }

  /* ---------------- números grandes ---------------- */

  function bigStr(n) {
    var v = Math.floor(Number(n) || 0);
    if (v <= Number.MAX_SAFE_INTEGER) return String(v);
    try { return BigInt(Math.round(v)).toString(); } catch (e) { return '0'; }
  }

  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { var n = Number(v); return isFinite(n) ? n : 0; }
    return 0;
  }

  /* ---------------- HTTP ---------------- */

  /** Modo de API: 'rest' (PostgREST/Supabase-like) o 'vice' (backend del repo). */
  function apiMode() {
    var c = loadConf();
    try {
      var m = root.localStorage.getItem('viceIdle_backend_mode');
      if (m) return m;
    } catch (e) { /* ignore */ }
    // un backend propio usa la API del repo; un PostgREST ajeno, el modo rest
    if (!c.url || c.url === '.' || c.url === '') return 'vice';
    return /supabase\.co$/i.test(c.url) ? 'rest' : 'vice';
  }

  function setApiMode(m) {
    try { root.localStorage.setItem('viceIdle_backend_mode', m === 'vice' ? 'vice' : 'rest'); } catch (e) { /* ignore */ }
    return apiMode();
  }

  function request(method, path, body, extraHeaders) {
    var c = loadConf();
    if (!c.enabled || !c.key || !(c.url || c.url === '.')) return Promise.resolve({ ok: false, reason: 'not_configured' });
    // '.' o '' → mismo origen (el servidor del juego hace de proxy al backend)
    var url = (c.url === '.' ? '' : c.url) + path;
    var headers = Object.assign({
      'apikey': c.key,
      'Authorization': 'Bearer ' + c.key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }, extraHeaders || {});
    var opts = { method: method, headers: headers };
    if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
    return root.fetch(url, opts).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (!r.ok) {
          return {
            ok: false, status: r.status,
            reason: (data && data.message) || ('http_' + r.status),
            code: data && data.code, data: data
          };
        }
        return { ok: true, status: r.status, data: data };
      });
    }).catch(function (err) {
      return { ok: false, reason: 'network', error: err && err.message };
    });
  }

  function rpc(fn, args) {
    return request('POST', '/rest/v1/rpc/' + fn, args || {});
  }

  /* ---------------- identidad del jugador ---------------- */

  /** ID de jugador: UUID v4 estable por nombre, guardado en la partida. */
  function ensurePlayerId() {
    var core = root.Core;
    if (!core || !core.state) return null;
    var id = core.state.cloud && core.state.cloud.playerId;
    if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
    id = uuidv4();
    core.state.cloud = core.state.cloud || {};
    core.state.cloud.playerId = id;
    core.save('cloud-id');
    return id;
  }

  function uuidv4() {
    if (root.crypto && root.crypto.randomUUID) {
      try { return root.crypto.randomUUID(); } catch (e) { /* sigue */ }
    }
    var b = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = [];
    for (var j = 0; j < 16; j++) hex.push(('0' + b[j].toString(16)).slice(-2));
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' +
           hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
  }

  /** Snapshot de lo que se sube al marcador. */
  function snapshot() {
    var core = root.Core;
    var s = core.state;
    return {
      p_name: core.player.name,
      p_player_id: ensurePlayerId(),
      p_balance: bigStr(s.cash),
      p_total_earned: bigStr(s.totalEarned),
      p_rank_index: core.rankIndex(),
      p_style: Math.floor(s.style || 0),
      p_vip_until: s.vipUntil ? new Date(s.vipUntil).toISOString() : null,
      p_device: 'web'
    };
  }

  /* ---------------- operaciones ---------------- */

  function register(extra) {
    var snap = snapshot();
    var args = Object.assign(snap, extra || {});
    if (apiMode() === 'vice') {
      var body = {
        name: snap.p_name,
        playerId: snap.p_player_id,
        balance: snap.p_balance,
        totalEarned: snap.p_total_earned,
        rankIndex: snap.p_rank_index,
        style: snap.p_style,
        vipUntil: snap.p_vip_until,
        device: snap.p_device
      };
      return request('POST', '/v1/sync', body).then(function (r) {
        if (!r.ok) return r;
        // el backend puede devolver un playerId ya existente (mismo nombre)
        if (r.data && r.data.playerId && r.data.playerId !== snap.p_player_id) {
          var core = root.Core;
          core.state.cloud = core.state.cloud || {};
          core.state.cloud.playerId = r.data.playerId;
          core.save('cloud-adopt');
        }
        recordSync();
        return { ok: true, data: r.data };
      });
    }
    return rpc('player_sync', args).then(function (r) {
      if (!r.ok) return r;
      recordSync();
      return { ok: true, data: r.data };
    });
  }

  function sync() {
    if (!configured()) return Promise.resolve({ ok: false, reason: 'not_configured' });
    return register().then(function (r) {
      if (r.ok) {
        var core = root.Core;
        core.state.cloud.lastSync = Date.now();
        core.emit('change', 'cloud');
      }
      return r;
    });
  }

  /** Lee un jugador por ID (para vincular dispositivos o restaurar). */
  function get(playerId) {
    var id = playerId || ensurePlayerId();
    if (apiMode() === 'vice') {
      return request('GET', '/v1/player/' + encodeURIComponent(id)).then(function (r) {
        if (!r.ok) return r;
        var row = r.data;
        if (!row || !row.playerId) return { ok: false, reason: 'not_found' };
        return {
          ok: true,
          player: {
            name: row.name,
            balance: num(row.balance),
            totalEarned: num(row.totalEarned),
            rankIndex: num(row.rankIndex),
            style: num(row.style),
            vipUntil: row.vipUntil ? Date.parse(row.vipUntil) : 0,
            lastSeen: row.lastSeen ? Date.parse(row.lastSeen) : 0,
            playerId: row.playerId
          }
        };
      });
    }
    return rpc('player_get', { p_player_id: id }).then(function (r) {
      if (!r.ok) return r;
      var row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!row) return { ok: false, reason: 'not_found' };
      return {
        ok: true,
        player: {
          name: row.name,
          balance: num(row.balance),
          totalEarned: num(row.total_earned),
          rankIndex: num(row.rank_index),
          style: num(row.style),
          vipUntil: row.vip_until ? Date.parse(row.vip_until) : 0,
          lastSeen: row.last_seen ? Date.parse(row.last_seen) : 0,
          playerId: row.player_id || id
        }
      };
    });
  }

  /** Restaura la partida local desde el marcador (solo campos de balance). */
  function restore(playerId) {
    return get(playerId).then(function (r) {
      if (!r.ok) return r;
      var core = root.Core;
      var p = r.player;
      core.state.cash = Math.max(0, p.balance);
      core.state.totalEarned = Math.max(core.state.totalEarned, p.totalEarned);
      core.state.style = Math.max(core.state.style || 0, p.style || 0);
      if (p.vipUntil > Date.now()) core.state.vipUntil = Math.max(core.state.vipUntil || 0, p.vipUntil);
      core.state.cloud.playerId = p.playerId || playerId;
      core.save('cloud-restore');
      core.emit('change', 'cloud-restore');
      return { ok: true, player: p };
    });
  }

  function leaderboard(limit) {
    var n = limit || 25;
    var path = apiMode() === 'vice'
      ? '/v1/leaderboard?limit=' + n
      : '/rest/v1/leaderboard?select=name,balance,total_earned,rank_index,vip_until,last_seen&order=balance.desc&limit=' + n;
    return request('GET', path)
      .then(function (r) {
        if (!r.ok) return r;
        var rows = apiMode() === 'vice' ? (r.data && r.data.rows || []) : (Array.isArray(r.data) ? r.data : []);
        return {
          ok: true,
          rows: rows.map(function (x) {
            return {
              name: x.name,
              balance: num(x.balance),
              totalEarned: num(x.totalEarned !== undefined ? x.totalEarned : x.total_earned),
              rankIndex: num(x.rankIndex !== undefined ? x.rankIndex : x.rank_index),
              vip: x.vip === true || !!(x.vip_until && Date.parse(x.vip_until) > Date.now()),
              lastSeen: (x.lastSeen || x.last_seen) ? Date.parse(x.lastSeen || x.last_seen) : 0
            };
          })
        };
      });
  }

  function stats() {
    var path = apiMode() === 'vice' ? '/v1/stats' : '/rest/v1/game_stats?select=*';
    return request('GET', path).then(function (r) {
      if (!r.ok) return r;
      var row = Array.isArray(r.data) ? r.data[0] : r.data;
      return { ok: true, stats: row || null };
    });
  }

  /** Ping de salud: comprueba que la URL/key responden. */
  function ping() {
    var path = apiMode() === 'vice' ? '/v1/leaderboard?limit=1' : '/rest/v1/leaderboard?select=name&limit=1';
    return request('GET', path).then(function (r) {
      if (r.ok) return { ok: true };
      if (r.status === 404) return { ok: false, reason: 'no_schema' };
      return r;
    });
  }

  /**
   * Pide el voucher de retiro al backend (valida rango/VIP y cupos allí).
   * Devuelve { ok, voucher } o { ok:false, reason }.
   */
  function requestWithdraw(greed, wallet) {
    if (!configured()) return Promise.resolve({ ok: false, reason: 'not_configured' });
    var id = ensurePlayerId();
    if (apiMode() === 'vice') {
      return request('POST', '/v1/withdraw', { playerId: id, greed: String(greed), wallet: wallet || null })
        .then(function (r) {
          if (!r.ok) return r;
          return { ok: true, voucher: r.data.voucher, rate: r.data.rate, vip: r.data.vip };
        });
    }
    return rpc('swap_request', { p_player_id: id, p_greed: String(greed), p_wallet: wallet || null })
      .then(function (r) { return r.ok ? { ok: true, voucher: r.data } : r; });
  }

  /* ---------------- bucle de subida automática ---------------- */

  var timer = null;
  var recordSyncFn = function () {};

  function recordSync() {
    cache.lastSync = Date.now();
    recordSyncFn();
  }

  function start() {
    if (!configured()) return { ok: false, reason: 'not_configured' };
    var conf = loadConf();
    ensurePlayerId();
    register();
    if (conf.auto && !timer) {
      timer = root.setInterval(function () {
        if (document && document.hidden) return;
        sync();
      }, AUTO_SYNC_MS);
    }
    // subida al salir
    if (!root.__viceCloudHook) {
      root.__viceCloudHook = true;
      root.addEventListener('beforeunload', function () {
        if (!configured()) return;
        try {
          var body = JSON.stringify(snapshot());
          var c = loadConf();
          if (root.navigator && root.navigator.sendBeacon) {
            // sendBeacon no permite cabeceras: usamos fetch keepalive
            root.fetch(c.url + '/rest/v1/rpc/player_sync', {
              method: 'POST', keepalive: true,
              headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
              body: body
            });
          }
        } catch (e) { /* salir siempre */ }
      });
    }
    return { ok: true };
  }

  function stop() {
    if (timer) { root.clearInterval(timer); timer = null; }
  }

  function status() {
    var c = loadConf();
    return {
      configured: configured(),
      url: c.url ? c.url.replace(/https:\/\/([a-z0-9]{6}).*/, 'https://$1…') : '',
      auto: c.auto,
      playerId: (root.Core && root.Core.state && root.Core.state.cloud) ? root.Core.state.cloud.playerId : null,
      lastSync: (root.Core && root.Core.state && root.Core.state.cloud) ? root.Core.state.cloud.lastSync : 0
    };
  }

  var Cloud = {
    CONF_KEY: CONF_KEY,
    AUTO_SYNC_MS: AUTO_SYNC_MS,
    loadConf: loadConf,
    saveConf: saveConf,
    clearConf: clearConf,
    configured: configured,
    validateConfig: validateConfig,
    bigStr: bigStr,
    ensurePlayerId: ensurePlayerId,
    snapshot: snapshot,
    register: register,
    sync: sync,
    get: get,
    restore: restore,
    leaderboard: leaderboard,
    requestWithdraw: requestWithdraw,
    apiMode: apiMode,
    setApiMode: setApiMode,
    stats: stats,
    ping: ping,
    start: start,
    stop: stop,
    status: status,
    // inyección para tests
    _onSync: function (fn) { recordSyncFn = fn || function () {}; },
    _request: request,
    _rpc: rpc
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Cloud;
  root.Cloud = Cloud;
})(typeof window !== 'undefined' ? window : globalThis);
