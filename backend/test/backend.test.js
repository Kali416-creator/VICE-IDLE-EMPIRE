/* =====================================================================
 * VICE IDLE · NEON EMPIRE — backend/test/backend.test.js
 * Tests del backend del marcador, sin dependencias:  node test/backend.test.js
 * ===================================================================== */
import assert from 'assert';
import http from 'http';
import { createApp, SWAP } from '../src/server.js';
import { MemoryStore } from '../src/db.js';

const API_KEY = 'test-public-key-123';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✘', name, extra === undefined ? '' : extra); }
}

const cfg = {
  port: 0, host: '127.0.0.1', databaseUrl: '', publicKey: API_KEY,
  relayerSeed: '', maxBodyBytes: 65536, rateLimitPerMin: 100000
};

const store = new MemoryStore();
const app = createApp({ cfg, store });
const server = http.createServer((req, res) => { app.handle(req, res).catch(() => res.writeHead(500).end('{}')); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: Object.assign({ 'content-type': 'application/json', 'x-api-key': API_KEY }, headers),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { status: res.status, data };
}

const P1 = '11111111-2222-4333-8444-555555555555';
const P2 = '99999999-8888-4777-8666-555555555555';

console.log('\n  VICE IDLE · tests del backend\n');

/* ---------- salud y auth ---------- */
let r = await call('GET', '/health', null, { 'x-api-key': '' });
ok('health responde sin clave', r.status === 200 && r.data.ok === true);

r = await call('GET', '/v1/leaderboard', null, { 'x-api-key': 'otra' });
ok('clave incorrecta → 401', r.status === 401 && r.data.error === 'api_key');

/* ---------- sync ---------- */
r = await call('POST', '/v1/sync', {
  name: 'neon_king', playerId: P1, balance: '1000', totalEarned: '2500', rankIndex: 1, style: 0
});
ok('primer sync crea el jugador', r.status === 200 && r.data.isNew === true && r.data.playerId === P1);

r = await call('POST', '/v1/sync', {
  name: 'neon_king', playerId: P1, balance: '5000000', totalEarned: '9000000', rankIndex: 2, style: 3
});
ok('segundo sync actualiza el balance', r.status === 200 && r.data.isNew === false && r.data.balance === '5000000');
ok('sync_count sube', r.data.syncCount === 2, r.data.syncCount);

r = await call('POST', '/v1/sync', {
  name: 'otro', playerId: P2, balance: '1', totalEarned: '1', rankIndex: 0
});
ok('nombre válido distinto', r.status === 200);

r = await call('POST', '/v1/sync', {
  name: 'neon_king', playerId: '22222222-3333-4555-8666-777777777777', balance: '1', totalEarned: '1', rankIndex: 0
});
ok('el mismo nombre desde otro equipo adopta la fila', r.status === 200 && r.data.playerId === P1 && r.data.adopted === true, JSON.stringify(r.data).slice(0, 120));

r = await call('POST', '/v1/sync', { name: 'a b', playerId: P1, balance: '1', totalEarned: '1' });
ok('nombre inválido → 400', r.status === 400 && r.data.error === 'name');

r = await call('POST', '/v1/sync', { name: 'ok_name', playerId: 'nope', balance: '1', totalEarned: '1' });
ok('playerId inválido → 400', r.status === 400 && r.data.error === 'playerId');

r = await call('POST', '/v1/sync', { name: 'ok_name', playerId: P1, balance: '1e21', totalEarned: '1' });
ok('notación científica rechazada', r.status === 400 && r.data.error === 'balance');

r = await call('POST', '/v1/sync', {
  name: 'big', playerId: P1, balance: '1000000000000000000000', totalEarned: '2500000000000000000000', rankIndex: 7
});
ok('acepta números ≥ 1e21 como texto', r.status === 200 && r.data.totalEarned === '2500000000000000000000');

/* ---------- lectura ---------- */
r = await call('GET', '/v1/player/' + P1);
ok('player_get devuelve el jugador', r.status === 200 && r.data.name === 'big');
r = await call('GET', '/v1/player/' + '00000000-0000-4000-8000-000000000000');
ok('jugador inexistente → 404', r.status === 404);
r = await call('GET', '/v1/player/nope');
ok('id con formato malo → 400', r.status === 400);

r = await call('GET', '/v1/leaderboard?limit=5');
ok('leaderboard ordena por balance', r.status === 200 && r.data.rows[0].name === 'big');
r = await call('GET', '/v1/leaderboard?limit=999');
ok('leaderboard limita a 100', r.status === 200 && r.data.rows.length <= 100);

r = await call('GET', '/v1/stats');
ok('stats agrega jugadores', r.status === 200 && r.data.players === 2, JSON.stringify(r.data));

/* ---------- retiros: puerta de rango ---------- */
r = await call('POST', '/v1/withdraw', { playerId: P2, greed: 1000000, wallet: '0x' + '1'.repeat(40) });
ok('sin rango ni VIP → need_rank', r.status === 403 && r.data.error === 'need_rank');
ok('need_rank dice que el VIP salta la puerta', r.data.vipBypass === true);

r = await call('POST', '/v1/withdraw', { playerId: P1, greed: 500000, wallet: '0x' + '1'.repeat(40) });
ok('bajo el mínimo → below_min', r.status === 400 && r.data.error === 'below_min');

r = await call('POST', '/v1/withdraw', { playerId: P1, greed: 1000000, wallet: '0x' + '1'.repeat(40) });
ok('rango alto + mínimo OK → voucher', r.status === 200 && r.data.ok === true);
ok('voucher: 1 000 000 G$ = 0.10 USDT', r.data.voucher.usdt === 0.1, r.data.voucher && r.data.voucher.usdt);
ok('tasa del backend = 10 000 000 G$/USDT', SWAP.epochRate === 10000000);

r = await call('POST', '/v1/withdraw', { playerId: P1, greed: 1000000, wallet: '0x' + '1'.repeat(40) });
ok('2 × 0.10 = cupo exacto 0.20 → permitido', r.status === 200 && r.data.voucher.usdt === 0.1, JSON.stringify(r.data).slice(0, 120));

r = await call('POST', '/v1/withdraw', { playerId: P1, greed: 1000000, wallet: '0x' + '1'.repeat(40) });
ok('el tercer retiro del día → player_cap', r.status === 429 && r.data.error === 'player_cap', JSON.stringify(r.data));

r = await call('POST', '/v1/withdraw', { playerId: P1, greed: 2000000, wallet: '0x' + '1'.repeat(40) });
ok('pedir 0.20 con 0.20 ya usados → player_cap', r.status === 429 && r.data.error === 'player_cap');

/* ---------- retiros: VIP salta la puerta ---------- */
await call('POST', '/v1/sync', {
  name: 'vip_guy', playerId: P2, balance: '1000000', totalEarned: '5000', rankIndex: 0,
  vipUntil: new Date(Date.now() + 86400000).toISOString()
});
r = await call('POST', '/v1/withdraw', { playerId: P2, greed: 1000000, wallet: '0x' + '2'.repeat(40) });
ok('VIP sin rango puede retirar', r.status === 200 && r.data.ok === true && r.data.vip === true);

/* ---------- validaciones de cuerpo ---------- */
r = await call('POST', '/v1/withdraw', { playerId: P1, greed: 'abc' });
ok('greed no numérico → 400', r.status === 400 && r.data.error === 'greed');
r = await call('POST', '/v1/withdraw', { playerId: 'x', greed: 1000000 });
ok('playerId inválido en withdraw → 400', r.status === 400);
r = await call('GET', '/nada');
ok('ruta desconocida → 404', r.status === 404);
r = await call('OPTIONS', '/v1/sync');
ok('preflight CORS → 204', r.status === 204);

/* ---------- rate limit ---------- */
const tight = createApp({ cfg: Object.assign({}, cfg, { rateLimitPerMin: 2 }), store: new MemoryStore() });
const s2 = http.createServer((req, res) => { tight.handle(req, res); });
await new Promise(r2 => s2.listen(0, '127.0.0.1', r2));
const base2 = `http://127.0.0.1:${s2.address().port}`;
let codes = [];
for (let i = 0; i < 4; i++) {
  const res = await fetch(base2 + '/health', { headers: { 'x-api-key': API_KEY } });
  codes.push(res.status);
}
ok('rate limit corta tras el tope', codes.filter(c => c === 429).length >= 2, codes.join(','));

server.close(); s2.close();
console.log(`\n  ${pass} ok · ${fail} fallos\n`);
process.exit(fail ? 1 : 0);
