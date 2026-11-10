/* Carga de configuración del backend. Sin dependencias externas. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..', '..');

/** Lee pares CLAVE=valor de .env.local (raíz) y backend/.env si existen. */
export function loadEnv(files = ['.env.local', 'backend/.env']) {
  for (const rel of files) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
  return process.env;
}

export function config() {
  loadEnv();
  return {
    port: Number(process.env.BACKEND_PORT || process.env.PORT || 8787),
    host: process.env.BACKEND_HOST || '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL || '',
    // clave pública que el juego envía en `apikey` (no es un secreto de admin)
    publicKey: process.env.BACKEND_PUBLIC_KEY || '',
    // secreto con el que se firman los vouchers de retiro
    relayerSeed: process.env.RELAYER_SEED || '',
    // tope de cuerpos y rate-limit básico
    maxBodyBytes: Number(process.env.BACKEND_MAX_BODY || 64 * 1024),
    rateLimitPerMin: Number(process.env.BACKEND_RATE_LIMIT || 120)
  };
}
