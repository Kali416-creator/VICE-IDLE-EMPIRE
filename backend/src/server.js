/* =====================================================================
 * VICE IDLE · NEON EMPIRE — backend/src/server.js
 * API del marcador (registro de jugadores y balance). Sin framework.
 *
 *   POST /v1/sync            { name, playerId, balance, totalEarned, rankIndex, style, vipUntil }
 *   GET  /v1/player/:id      → fila del jugador
 *   GET  /v1/leaderboard     → top N
 *   GET  /v1/stats           → estadísticas agregadas
 *   POST /v1/withdraw        { playerId, greed, wallet } → voucher firmado (requiere rango o VIP)
 *   GET  /health
 *
 * Seguridad:
 *  - Requiere la cabecera `x-api-key` con BACKEND_PUBLIC_KEY (no es un secreto
 *    de administración: va en el cliente, pero corta el ruido y los bots).
 *  - La tabla de jugadores NO se expone: solo estas rutas.
 *  - Es un marcador, no un libro contable: el dinero real lo mueve el
 *    contrato (voucher + topes on-chain).
 * ===================================================================== */
import http from 'http';
import crypto from 'crypto';
import { config } from './env.js';
import { makeStore, signVoucher } from './db.js';

const NAME_RE = /^[A-Za-z0-9_]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AMOUNT_RE = /^[0-9]{1,32}(\.[0-9]{1,6})?$/;

// topes de retiro (deben coincidir con src/data.js → DATA.swap)
export const SWAP = {
  epochRate: 10000000,          // 1 000 000 G$ = 0.10 USDT
  minUsdt: 0.10,
  playerDailyCapUsdt: 0.20,
  globalDailyCapUsdt: 25,
  minRankIndex: 3,
  vipSkipsRankGate: true
};

export function createApp(deps = {}) {
  const cfg = deps.cfg || config();
  const store = deps.store;
  const now = deps.now || (() => Date.now());
  const hits = new Map();      // rate-limit básico en memoria
  const usedToday = new Map(); // playerId -> { day, usdtMicro }
  let globalDay = { day: '', usdtMicro: 0 }; // consumo global del día

  function dayKey(ts = now()) { return new Date(ts).toISOString().slice(0, 10); }

  function rateLimited(ip) {
    const minute = Math.floor(now() / 60000);
    const key = ip + ':' + minute;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (hits.size > 5000) hits.clear();
    return n > cfg.rateLimitPerMin;
  }

  function json(res, code, body) {
    const txt = JSON.stringify(body);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(txt),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type, x-api-key, apikey, authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(txt);
  }

  function apiKeyOf(req) {
    return req.headers['x-api-key'] || req.headers['apikey'] ||
      String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', c => {
        size += c.length;
        if (size > cfg.maxBodyBytes) { reject(new Error('too_large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('bad_json')); }
      });
      req.on('error', reject);
    });
  }

  /* ---------------- validación ---------------- */

  function validateSync(b) {
    if (!b || typeof b !== 'object') return { error: 'body' };
    const name = String(b.name || '').trim();
    if (!NAME_RE.test(name)) return { error: 'name' };
    if (!UUID_RE.test(String(b.playerId || ''))) return { error: 'playerId' };
    const balance = String(b.balance == null ? '' : b.balance);
    const total = String(b.totalEarned == null ? '' : b.totalEarned);
    if (!AMOUNT_RE.test(balance)) return { error: 'balance' };
    if (!AMOUNT_RE.test(total)) return { error: 'totalEarned' };
    const rankIndex = Math.max(0, Math.min(7, Number(b.rankIndex) || 0));
    const style = Math.max(0, Math.min(1000000, Number(b.style) || 0));
    let vipUntil = null;
    if (b.vipUntil) {
      const ts = Date.parse(b.vipUntil);
      if (isFinite(ts)) vipUntil = new Date(ts).toISOString();
    }
    return {
      row: {
        player_id: String(b.playerId), name,
        balance, total_earned: total,
        rank_index: rankIndex, style, vip_until: vipUntil,
        device: String(b.device || 'web').slice(0, 20)
      }
    };
  }

  function rankFor(balance) {
    const R = [0, 1e3, 1e6, 1e9, 1e12, 1e15, 1e18, 1e21];
    let idx = 0;
    for (let i = 0; i < R.length; i++) if (balance >= R[i]) idx = i;
    return idx;
  }

  /* ---------------- rutas ---------------- */

  async function sync(req, res) {
    const b = await readBody(req);
    const v = validateSync(b);
    if (v.error) return json(res, 400, { ok: false, error: v.error });
    const other = await store.findByName(v.row.name);
    if (other && other.player_id !== v.row.player_id) {
      // mismo nombre desde otro dispositivo/almacén local: se continúa con la
      // fila existente (el marcador no es un libro contable y el nombre ya está
      // probado en el cliente). El playerId local se sincroniza con el servidor.
      const r = await store.upsert(Object.assign({}, v.row, { player_id: other.player_id }));
      return json(res, 200, {
        ok: true,
        isNew: false,
        playerId: other.player_id,
        adopted: true,
        balance: String(r.row.balance),
        totalEarned: String(r.row.total_earned),
        rankIndex: r.row.rank_index,
        syncCount: Number(r.row.sync_count)
      });
    }
    const r = await store.upsert(v.row);
    return json(res, 200, {
      ok: true,
      isNew: r.isNew,
      playerId: r.row.player_id,
      balance: String(r.row.balance),
      totalEarned: String(r.row.total_earned),
      rankIndex: r.row.rank_index,
      syncCount: Number(r.row.sync_count)
    });
  }

  async function player(res, id) {
    if (!UUID_RE.test(id)) return json(res, 400, { ok: false, error: 'playerId' });
    const row = await store.findByPlayerId(id);
    if (!row) return json(res, 404, { ok: false, error: 'not_found' });
    return json(res, 200, {
      ok: true,
      playerId: row.player_id,
      name: row.name,
      balance: String(row.balance),
      totalEarned: String(row.total_earned),
      rankIndex: row.rank_index,
      style: row.style,
      vipUntil: row.vip_until,
      lastSeen: row.last_seen
    });
  }

  async function leaderboard(res, url) {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 25));
    const rows = await store.leaderboard(limit);
    return json(res, 200, {
      ok: true,
      rows: rows.map(r => ({
        name: r.name,
        balance: String(r.balance),
        totalEarned: String(r.total_earned),
        rankIndex: Number(r.rank_index),
        vip: !!(r.vip_until && Date.parse(r.vip_until) > now()),
        lastSeen: r.last_seen
      }))
    });
  }

  async function stats(res) {
    const s = await store.stats();
    return json(res, 200, {
      ok: true,
      players: Number(s.players || 0),
      totalBalance: String(s.total_balance || 0),
      topRank: Number(s.top_rank || 0),
      vipPlayers: Number(s.vip_players || 0)
    });
  }

  /**
   * Solicitud de retiro: valida rango (o VIP) y cupos, y devuelve el voucher
   * firmado. Con RELAYER_SEED configurado se firma de verdad; sin él, se
   * devuelve el voucher marcado como `unsigned` para probar el flujo.
   */
  async function withdraw(req, res) {
    const b = await readBody(req);
    const playerId = String(b.playerId || '');
    if (!UUID_RE.test(playerId)) return json(res, 400, { ok: false, error: 'playerId' });
    const greed = Number(String(b.greed == null ? '' : b.greed).replace(/[^0-9]/g, ''));
    if (!isFinite(greed) || greed <= 0) return json(res, 400, { ok: false, error: 'greed' });

    const row = await store.findByPlayerId(playerId);
    if (!row) return json(res, 404, { ok: false, error: 'not_found' });

    const vip = !!(row.vip_until && Date.parse(row.vip_until) > now());
    const rankIndex = Math.max(Number(row.rank_index) || 0, rankFor(Number(row.balance)));
    if (rankIndex < SWAP.minRankIndex && !(vip && SWAP.vipSkipsRankGate)) {
      return json(res, 403, {
        ok: false, error: 'need_rank', need: SWAP.minRankIndex, current: rankIndex,
        vipBypass: SWAP.vipSkipsRankGate
      });
    }

    // Todo en MICRO-USDT enteros: 0.1 + 0.2 en coma flotante no es fiable.
    const usdtMicro = Math.floor(greed / SWAP.epochRate * 1e6);
    const usdt = usdtMicro / 1e6;
    if (usdtMicro < Math.round(SWAP.minUsdt * 1e6)) {
      return json(res, 400, { ok: false, error: 'below_min', minUsdt: SWAP.minUsdt });
    }

    const day = dayKey();
    const used = usedToday.get(playerId);
    const spentMicro = used && used.day === day ? used.usdtMicro : 0;
    // el cupo se reserva al pedir: como mucho hay un retiro en vuelo
    if (spentMicro + usdtMicro > Math.round(SWAP.playerDailyCapUsdt * 1e6)) {
      return json(res, 429, {
        ok: false, error: 'player_cap', cap: SWAP.playerDailyCapUsdt, used: spentMicro / 1e6
      });
    }
    if (globalDay.day !== day) globalDay = { day, usdtMicro: 0 };
    if (globalDay.usdtMicro + usdtMicro > Math.round(SWAP.globalDailyCapUsdt * 1e6)) {
      return json(res, 429, {
        ok: false, error: 'global_cap', cap: SWAP.globalDailyCapUsdt, used: globalDay.usdtMicro / 1e6
      });
    }

    const deadline = Math.floor(now() / 1000) + 3600;
    const nonce = spentMicro === 0 ? 1 : Math.ceil(spentMicro / 1e5) + 1;
    let voucher;
    if (cfg.relayerSeed) {
      voucher = signVoucher(cfg.relayerSeed, { player: String(b.wallet || '0x' + '0'.repeat(40)), greed, usdt, deadline, nonce });
      voucher.unsigned = false;
    } else {
      voucher = {
        player: String(b.wallet || '0x' + '0'.repeat(40)),
        greed: String(greed), usdt, deadline, nonce,
        signature: '0x' + crypto.randomBytes(65).toString('hex'),
        unsigned: true
      };
    }
    usedToday.set(playerId, { day, usdtMicro: spentMicro + usdtMicro });
    globalDay.usdtMicro += usdtMicro;
    return json(res, 200, { ok: true, voucher, rate: SWAP.epochRate, vip });
  }

  /* ---------------- servidor ---------------- */

  async function handle(req, res) {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    if (req.method === 'OPTIONS') return json(res, 204, {});

    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) return json(res, 429, { ok: false, error: 'rate_limit' });

    if (url.pathname === '/health') {
      return json(res, 200, { ok: true, service: 'vice-idle-backend', at: new Date(now()).toISOString() });
    }

    if (cfg.publicKey && apiKeyOf(req) !== cfg.publicKey) {
      return json(res, 401, { ok: false, error: 'api_key' });
    }

    try {
      if (req.method === 'POST' && url.pathname === '/v1/sync') return await sync(req, res);
      if (req.method === 'POST' && url.pathname === '/v1/withdraw') return await withdraw(req, res);
      if (req.method === 'GET' && url.pathname.startsWith('/v1/player/')) {
        return await player(res, url.pathname.slice('/v1/player/'.length));
      }
      if (req.method === 'GET' && url.pathname === '/v1/leaderboard') return await leaderboard(res, url);
      if (req.method === 'GET' && url.pathname === '/v1/stats') return await stats(res);
      return json(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      const code = err && err.message === 'too_large' ? 413 : err && err.message === 'bad_json' ? 400 : 500;
      return json(res, code, { ok: false, error: code === 500 ? 'server' : err.message });
    }
  }

  return { handle, store, SWAP };
}

export async function start() {
  const cfg = config();
  const store = await makeStore(cfg);
  const app = createApp({ cfg, store });
  const server = http.createServer((req, res) => {
    app.handle(req, res).catch(() => { try { res.writeHead(500).end('{"ok":false}'); } catch (e) { /* ignore */ } });
  });
  // permite vaciar el almacén en memoria sin reiniciar (solo desarrollo/tests)
  process.on('SIGUSR2', () => {
    if (store instanceof Object && store.players instanceof Map) {
      store.players.clear();
      store.visits.length = 0;
      console.log('[backend] almacén en memoria vaciado');
    }
  });
  await new Promise(r => server.listen(cfg.port, cfg.host, r));
  const addr = server.address();
  console.log(`VICE IDLE · backend ${store.constructor.name} en http://${cfg.host}:${addr.port}`);
  console.log(`  api key  ${cfg.publicKey ? 'requerida (x-api-key)' : 'libre (solo desarrollo)'}`);
  console.log(`  firma    ${cfg.relayerSeed ? 'relayer configurado' : 'sin relayer (vouchers unsigned)'}`);
  console.log(`  db       ${cfg.databaseUrl ? 'postgres' : 'memoria'}`);
  return { server, app, store };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  start().catch(err => { console.error('[backend] no arranca:', err); process.exit(1); });
}
