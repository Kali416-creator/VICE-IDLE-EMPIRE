# VICE IDLE · NEON EMPIRE (v4.6)

> Este es a la vez el README del proyecto y el prompt de continuación.
> El proyecto vive en la raíz de este repositorio (antes `/home/user/vice-idle`).

---

## 1. Qué es el proyecto

**VICE IDLE · Neon Empire**: idle game (estilo Cookie Clicker) con temática de crimen neón
inspirada en GTA 6. Se juega en el navegador, sin red. Hay una moneda blanda cerrada
(**G$**) que se puede canjear por **USDT real (BEP-20, BSC)** bajo topes estrictos, y pases
**VIP de 30 / 60 / 90 días** pagados en USDT.

Entrega: **un único `vice-idle.html` autocontenido** (576 KB) + código fuente multiarchivo,
contratos Solidity, esquema SQL y batería de tests.

> Proyecto de ficción. Nada de esto representa ni promueve actividades reales.

---

## 2. Estado actual: v4.6 (todo verde)

| Versión | Qué se hizo |
|---|---|
| v1 | Núcleo del idle: negocios, mejoras, combo, calor policial, diaria, prestigio, i18n, WebAudio |
| v3 | Swap G$→USDT con revisión de impacto; contratos en BSC |
| v4 | Tasa por épocas + topes en USDT; presupuesto diario de producción; rango mínimo para retirar; referidos cosméticos |
| v4.1 | Inglés por defecto + portugués; presupuesto creciente por rango |
| v4.3 | Reparto VIP **30 % reserva / 70 % tesorería**; planes **12 / 22 / 30 USDT** |
| v4.4 | **Página de inicio de sesión** propia + cuentas locales (PBKDF2) · **eliminado todo rastro del backend gestionado** (sin SDK, sin esquema, sin Edge Functions) |
| v4.5 | Conexión **opcional** para registrar jugadores y balance (marcador) |
| v4.6 | **Backend propio** (sin rastro de Supabase en el juego) · **sección de Retiros** con rango mínimo y excepción VIP · tasa **1 000 000 G$ = 0.10 USDT** · sin detalle del reparto de ingresos en la UI |

**Tests ahora mismo:** 135 comprobaciones de navegador (playtest2–playtest5) + 32 del backend, todas en verde.
Los playtests se ejecutan con un Chromium headless real (`node tools/playtestN.js`).

---

## 3. Reglas de trabajo (importantes)

1. **Responder y documentar en español.** La UI del juego va en **EN (por defecto) / ES / PT**.
2. **No editar `vice-idle.html` a mano**: es un artefacto generado. Se regenera con `node tools/build.js`.
3. Antes de tocar economía, tasas o rangos: **análisis explícito con números** (tablas, simulaciones) y justificación.
4. Los **referidos NO afectan la economía**: solo cosméticos (títulos, skins, insignias).
5. Nada de token nativo. Solo dos monedas: G$ (blanda, cerrada) y USDT (real).
6. El **dinero solo lo mueve el contrato**. El cliente nunca decide un pago.
7. Nunca meter credenciales reales en el repo ni en el juego (solo la clave **anon public**).

---

## 4. Estructura de ficheros

```
vice-idle/
├─ vice-idle.html            ← build single-file (NO editar a mano)
├─ index.html · css/style.css
├─ src/
│  ├─ economy.js             fórmulas puras (compartidas con el simulador)
│  ├─ data.js                contenido + DATA.SWAP + DATA.RANKS + planes VIP
│  └─ i18n.js                463 claves × 3 idiomas (EN/ES/PT)
├─ js/
│  ├─ auth.js                página de login + cuentas locales (PBKDF2 120k)
│  ├─ exchange.js            libro del Cambio + referidos (por jugador)
│  ├─ backend.js             cliente del backend (registro, balance, retiros)
│  ├─ core.js                estado, ticks, presupuesto, guardado por jugador
│  ├─ chain.js               MetaMask + ethers v6 (lazy): VIP y claim del swap
│  ├─ ui.js                  render, modales, sonido, partículas
│  └─ main.js                arranque: i18n → Auth.boot → partida → Cloud.start
├─ backend/                  BACKEND del juego (marcador + retiros)
│  ├─ src/server.js          API /v1/sync · /v1/player · /v1/leaderboard · /v1/withdraw
│  ├─ src/db.js              Postgres (pg) o almacén en memoria
│  └─ migrations/001_schema.sql  players, player_visits, vistas
├─ contracts/                Hardhat: ViceIdleVault, ViceSwapVault, 39 tests
│  └─ scripts/               deploy.js · verify-flow.js · sign-voucher.js
├─ tools/                    build, simulador, playtests (2–9), shots, check-cloud
├─ docs/                     ARCHITECTURE.md · ECONOMY.md · SWAP_ANALYSIS.md
└─ screenshots/
```

**Orden de scripts en `index.html`** (importa):
`assets/inline.js → economy → data → i18n → core → auth → exchange → chain → backend → ui → main`.

---

## 5. Economía y constantes exactas

**Retiros**: puerta por rango **🚗 Corredor (10⁹)**. Quien tiene un **VIP activo** no está sujeto a
ese mínimo (`DATA.swap.vipSkipsRankGate`), en el cliente y en el backend.

**Rangos** (sobre G$ ganados de por vida, `totalEarned`; nunca bajan):

| # | Rango | Umbral | Horas F2P/día |
|---|---|---|---|
| 0 | 🐣 Novato | 0 | 6,0 |
| 1 | 👀 Soplón | 10³ | 6,5 |
| 2 | 🥊 Matón | 10⁶ | 7,0 |
| 3 | 🚗 **Corredor** (abre retiros) | **10⁹** | 7,5 |
| 4 | 🕴️ Capo | 10¹² | 8,0 |
| 5 | 🎩 Padrino | 10¹⁵ | 9,0 |
| 6 | 🌆 Leyenda Neón | 10¹⁸ | 10,0 |
| 7 | 👑 Dueño de Vice | 10²¹ | 12,0 |

`VIP = F2P × 4/3` en todos · presupuesto = `max(suelo_rango, renta/s × horas × 3600)` ·
al agotarse, goteo del **10 %** · reinicio 00:00 UTC · diaria y misiones **no** consumen presupuesto.

**Cambio G$ → USDT** (`DATA.SWAP`):

| Parámetro | Valor |
|---|---|
| Tasa época 1 | **1 000 000 G$ = 0,10 USDT** (⟹ 10 000 000 G$ = 1 USDT) |
| Recalibración | cada 14 días, paso máx. ±60 %, deriva acotada a ±25 % de la tasa de diseño |
| Mínimo por retiro | 0,10 USDT (= 1 000 000 G$) |
| Cupo por jugador/día | **0,20 USDT** (= 2 000 000 G$; 2 retiros mínimos) |
| Presupuesto global/día | **25 USDT** |
| Requisito | rango 🚗 Corredor (10⁹) **o VIP activo** |

**VIP** (`DATA.VIP.plans`): 30 d = **12 USDT** (0,400/día) · 60 d = **22** (0,367) · 90 d = **30** (0,333).
El reparto de cada pago **no se muestra en la página** (vive solo en el contrato:
`swapPoolBps 3000` / `treasuryBps 7000`).

**Sostenibilidad**: `global_daily_cap_usdt ≤ 0,5 × 0,30 × ingresos VIP del mes / 30`
⟹ ≈ 209 / 228 / 250 pases VIP activos por mes según plan (≈ 418–438 con colchón del 50 %).

---

## 6. Cómo construir y probar

```bash
cd /home/user/vice-idle

node tools/build.js          # regenera vice-idle.html (autocontenido)
node tools/shots.js          # capturas en screenshots/ (login EN/ES/PT, juego, móvil)

node tools/playtest2.js      # 37  reglas del juego (clic, negocios, calor, presupuesto…)
node tools/playtest3.js      # 31  página de login y cuentas locales (PBKDF2)
node tools/playtest4.js      # 39  Cambio, vouchers y referidos cosméticos
node tools/playtest5.js      # 28  sección de Retiros, rango mínimo y excepción VIP

node backend/test/backend.test.js   # 32  API del backend (sync, retiros, topes)

cd contracts && npx hardhat test    # 39 tests
```

**Tooling efímero (reinstalar si el entorno se reinicia):**

```bash
npm i --prefix /home/user playwright@1.47.0
sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
  libpango-1.0-0 libcairo2 libxshmfence1
export PLAYWRIGHT_BROWSERS_PATH=/home/user/.cache/ms-playwright   # chromium-1134 ya descargado
cd contracts && npm install                                        # hardhat + OZ
```

Los tests usan `tools/_login.js` (`ensureSigned` / `ensureGuest`) para pasar la página de login.

---

## 7. Cuentas, sesión y Cambio (v4.4)

- **Página de login a pantalla completa** (`#loginRoot`, `body.locked`): crear cuenta, entrar,
  jugar como invitado, selector EN/ES/PT. El juego no se renderiza hasta entrar.
- **Contraseñas**: PBKDF2-SHA256, 120 000 iteraciones + sal 16 B. Nunca en claro.
  Sin `crypto.subtle` (iframe sandbox / file://) cae a un hash salteado marcado `weak`.
- **Una ranura por jugador**: `viceIdle_save_v1::<nombre>` + `viceIdle_exchange_v2::<jugador>`.
  Sin `localStorage` hay espejo en memoria y el juego sigue funcionando.
- **Ajustes → Cuenta**: cambiar contraseña, borrar cuenta (con su partida), cambiar de jugador.
- **Cambio**: `Exchange.request` valida rango/mínimo/cupo → `pending`; el jugador **pega el
  voucher JSON** firmado por el operador → `signed`; «Reclamar» → `claimSwapWithSig` → `claimed` + tx.
  Rechazo → devuelve G$ y cupo.

**Script del relayer**: `contracts/scripts/sign-voucher.js` lee `epochRate` y `nonces` del
contrato, comprueba `RELAYER_ROLE` y emite el JSON exacto que el juego acepta:

```bash
cd contracts && RELAYER_PRIVATE_KEY=0x… node scripts/sign-voucher.js --player 0x… --greed 400000000
# otra red: HARDHAT_NETWORK=bscTestnet …   (usa deployments/<red>.json)
```

---

## 8. Backend (v4.6) — integrado, opcional para el jugador

El juego **no contiene ninguna referencia a Supabase**: habla con **su propio backend**
(`backend/`), que es el único que toca la base de datos. En el cliente solo hay una
conexión (`.env.local` → `VICE_BACKEND_URL=.` y una clave pública) y la sección
**⚙️ Ajustes → Base de datos y nube** para activarla, desactivarla o restaurar la partida.

```bash
node backend/src/server.js            # API en :8787 (memoria si no hay DATABASE_URL)
cd backend && npm install && npm test # 32 tests de la API
```

| Ruta | Para qué |
|---|---|
| `POST /v1/sync` | registra/actualiza `name`, `balance`, `total_earned`, `rank_index`, `vip_until` |
| `GET /v1/player/:id` | fila del jugador (vincular dispositivos / restaurar) |
| `GET /v1/leaderboard` | top del marcador |
| `GET /v1/stats` | agregados |
| `POST /v1/withdraw` | valida **rango o VIP** y cupos → devuelve el **voucher firmado** |

`tools/serve.js` hace de proxy `/v1/*` → backend, así el navegador usa siempre el mismo origen.

> **Límite conocido y aceptado:** el marcador no es un libro contable. El dinero real sigue
> protegido por el contrato (voucher firmado + topes on-chain).

---

## 9. Trampas conocidas (no repetir)

| Problema | Solución |
|---|---|
| Playwright "Target page closed" | Instalar las libs apt de arriba |
| `psql -f /dev/stdin` no funciona | Copiar el .sql a `/tmp` y usar `-f /tmp/x.sql` |
| `require` de playwright apunta a `/home/user/node_modules` | Si no existe, `npm i --prefix /home/user playwright@1.47.0` |
| **Después de `page.reload()`** hay carrera: `Auth.session()`/`Core.state` aún no existen | `waitForFunction` de `window.Auth && Core.state && localStorage.getItem(Core.saveKey())` |
| `i18n.js`: insertar claves sin coma en la entrada anterior | Rompe con `SyntaxError: Unexpected string`. Validar siempre conteos (463 × 3) |
| Números ≥ 1e21 | `String(1e21)` da `"1e+21"` → usar `BigInt(n).toString()` (ya en `cloud.js`) |
| SQL: `numeric(38,6)` | Acepta hasta 32 dígitos enteros; la regex del schema ya lo refleja |
| Modal de Ajustes con 4 columnas | Es `modal wide` de 3 columnas y la tarjeta de nube ocupa `1 / -1` |
| Ruta de Playwright | La **última** ruta registrada gana: el comodín va **antes** que las concretas |
| `days` es palabra reservada en Solidity | Usar `numDays` |

---

## 10. Pendientes sugeridos (siguiente iteración)

1. **Contratos Solidity** (`contracts/`): `ViceIdleVault` y `ViceSwapVault` con sus 39 tests.
2. **Anti-cheat del balance**: validación de producción en el backend antes de aceptar un `sync`.
3. **Recuperar cuenta en otro dispositivo** sin copiar el UUID a mano (código de 6 caracteres).
4. **Auditoría externa** de contratos + multisig/timelock para admin y relayer antes de mainnet.
5. **Contenido**: más negocios/misiones y eventos temporales, manteniendo el presupuesto diario.
6. **Añadir idioma**: un objeto más en `src/i18n.js` (502 claves) sin tocar el resto.
7. **Playtests p6–p9**: i18n por pestañas, planes VIP, backend y integración con Postgres.

---

## 11. Cómo quiero que trabajes

- Explica **qué vas a hacer y por qué** antes de tocar código; luego ejecuta y **enseña resultados**.
- Cambios **pequeños y verificados**: editar → `node --check` → `node tools/build.js` → playtests.
- Si algo no se puede (acceso a servicios con contraseña, red externa), **dilo claro** y ofrece la alternativa segura.
- Al terminar, resume en español: qué cambió, qué se probó (números), dónde está el artefacto.
