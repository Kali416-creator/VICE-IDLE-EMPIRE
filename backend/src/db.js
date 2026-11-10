/* Capa de datos. Usa Postgres si hay DATABASE_URL; si no, un almacén en
 * memoria (útil para tests y para desarrollo sin base de datos). */
import crypto from 'crypto';

export class MemoryStore {
  constructor() { this.players = new Map(); this.visits = []; }
  async findByPlayerId(id) { return this.players.get(id) || null; }
  async findByName(name) {
    for (const p of this.players.values()) if (p.name.toLowerCase() === String(name).toLowerCase()) return p;
    return null;
  }
  async upsert(row) {
    const cur = this.players.get(row.player_id);
    const isNew = !cur;
    const next = Object.assign({
      player_id: row.player_id,
      created_at: new Date().toISOString(),
      sync_count: 0
    }, cur || {}, {
      name: row.name,
      balance: row.balance,
      total_earned: row.total_earned,
      rank_index: row.rank_index,
      style: row.style,
      vip_until: row.vip_until || (cur && cur.vip_until) || null,
      device: row.device,
      last_seen: new Date().toISOString(),
      sync_count: ((cur && cur.sync_count) || 0) + 1
    });
    this.players.set(row.player_id, next);
    this.visits.push({ player_id: row.player_id, kind: isNew ? 'register' : 'sync', at: next.last_seen });
    return { row: next, isNew };
  }
  async leaderboard(limit = 25) {
    return [...this.players.values()]
      .sort((a, b) => Number(b.balance) - Number(a.balance))
      .slice(0, limit);
  }
  async stats() {
    const all = [...this.players.values()];
    return {
      players: all.length,
      total_balance: all.reduce((s, p) => s + Number(p.balance), 0),
      top_rank: all.reduce((m, p) => Math.max(m, p.rank_index), 0),
      vip_players: all.filter(p => p.vip_until && Date.parse(p.vip_until) > Date.now()).length
    };
  }
  async close() {}
}

export class PgStore {
  constructor(pool) { this.pool = pool; }
  async findByPlayerId(id) {
    const r = await this.pool.query('select * from players where player_id = $1', [id]);
    return r.rows[0] || null;
  }
  async findByName(name) {
    const r = await this.pool.query('select * from players where lower(name) = lower($1)', [name]);
    return r.rows[0] || null;
  }
  async upsert(row) {
    const q = await this.pool.query(
      `insert into players (player_id, name, balance, total_earned, rank_index, style, vip_until, device, sync_count)
       values ($1,$2,$3,$4,$5,$6,$7,$8,1)
       on conflict (player_id) do update set
         name = excluded.name,
         balance = excluded.balance,
         total_earned = excluded.total_earned,
         rank_index = excluded.rank_index,
         style = excluded.style,
         vip_until = coalesce(excluded.vip_until, players.vip_until),
         device = excluded.device,
         last_seen = now(),
         sync_count = players.sync_count + 1
       returning *, (xmax = 0) as is_new`,
      [row.player_id, row.name, row.balance, row.total_earned, row.rank_index, row.style, row.vip_until, row.device]
    );
    const out = q.rows[0];
    await this.pool.query('insert into player_visits (player_id, kind) values ($1,$2)',
      [out.player_id, out.is_new ? 'register' : 'sync']);
    return { row: out, isNew: !!out.is_new };
  }
  async leaderboard(limit = 25) {
    const r = await this.pool.query(
      'select name, balance, total_earned, rank_index, vip_until, last_seen from players order by balance desc limit $1',
      [limit]);
    return r.rows;
  }
  async stats() {
    const r = await this.pool.query('select * from game_stats');
    return r.rows[0] || {};
  }
  async close() { await this.pool.end(); }
}

export async function makeStore(cfg) {
  if (!cfg.databaseUrl) return new MemoryStore();
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 5, ssl: cfg.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } });
  return new PgStore(pool);
}

/** Firma ECDSA (secp256k1) del voucher de retiro — mismo formato que el contrato. */
export function signVoucher(seedHex, { player, greed, usdt, deadline, nonce }) {
  const msg = [player.toLowerCase(), String(greed), String(usdt), String(deadline), String(nonce)].join('|');
  const digest = crypto.createHash('sha256').update(msg).digest();
  // firma determinista de 65 bytes (r||s||v) con la clave del relayer
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(seedHex.replace(/^0x/, '').padStart(64, '0'), 'hex'));
  // NOTA: en producción se usa ethers/viem o el script contracts/scripts/sign-voucher.js
  const sig = crypto.sign('sha256', Buffer.isBuffer(msg) ? msg : Buffer.from(msg), {
    key: buildPem(seedHex), dsaEncoding: 'ieee-p1363'
  });
  return {
    player, greed: String(greed), usdt: Number(usdt), deadline, nonce,
    signature: '0x' + sig.toString('hex') + '1b',
    digest: digest.toString('hex')
  };
}

function buildPem(seedHex) {
  const raw = Buffer.from(seedHex.replace(/^0x/, '').padStart(64, '0'), 'hex');
  const prefix = Buffer.from('302e0201010420', 'hex');
  const suffix = Buffer.from('a00706052b8104000a', 'hex');
  const der = Buffer.concat([prefix, raw, suffix]);
  return '-----BEGIN EC PRIVATE KEY-----\n' + der.toString('base64') + '\n-----END EC PRIVATE KEY-----\n';
}
