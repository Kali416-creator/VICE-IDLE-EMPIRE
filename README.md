# PROMPT DE CONTINUACIÓN — VICE IDLE (v4.5)

> Copia desde aquí hacia abajo en una instancia nueva. El workspace ya existe en `/home/user/vice-idle`.

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

## 2. Estado actual: v4.5 (todo verde)

| Versión | Qué se hizo |
|---|---|
| v1 | Núcleo del idle: negocios, mejoras, combo, calor policial, diaria, prestigio, i18n, WebAudio |
| v3 | Swap G$→USDT con revisión de impacto; contratos en BSC |
| v4 | Tasa por épocas + topes en USDT; presupuesto diario de producción; rango mínimo para retirar; referidos cosméticos |
| v4.1 | Inglés por defecto + portugués; presupuesto creciente por rango |
| v4.3 | Reparto VIP **30 % reserva / 70 % tesorería**; planes **12 / 22 / 30 USDT** |
| v4.4 | **Página de inicio de sesión** propia + cuentas locales (PBKDF2) · **eliminado todo rastro del backend gestionado** (sin SDK, sin esquema, sin Edge Functions) |
| v4.5 | Conexión **opcional** con Supabase para registrar jugadores y balance (marcador) |

**Tests ahora mismo:** 163 tests de navegador (p2–p9) + 39 de contrato, todos en verde.

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
│  ├─ cloud.js               puente opcional con Supabase (registro + balance)
│  ├─ core.js                estado, ticks, presupuesto, guardado por jugador
│  ├─ chain.js               MetaMask + ethers v6 (lazy): VIP y claim del swap
│  ├─ ui.js                  render, modales, sonido, partículas
│  └─ main.js                arranque: i18n → Auth.boot → partida → Cloud.start
├─ supabase/
│  ├─ schema.sql             players, player_visits, player_sync/get, vistas
│  └─ README.md              guía de 1 minuto
├─ contracts/                Hardhat: ViceIdleVault, ViceSwapVault, 39 tests
│  └─ scripts/               deploy.js · verify-flow.js · sign-voucher.js
├─ tools/                    build, simulador, playtests (2–9), shots, check-cloud
├─ docs/                     ARCHITECTURE.md · ECONOMY.md · SWAP_ANALYSIS.md
└─ screenshots/
```

**Orden de scripts en `index.html`** (importa):
`assets/inline.js → economy → data → i18n → core → auth → exchange → chain → cloud → ui → main`.

---

## 5. Economía y constantes exactas

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
| Tasa época 1 | **2 000 000 000 G$ = 1 USDT** (recalibrable cada 14 días, paso máx. ±60 %) |
| Mínimo por cambio | 0,10 USDT (= 200 000 000 G$) |
| Cupo por jugador/día | **0,20 USDT** |
| Presupuesto global/día | **25 USDT** |
| Requisito | rango 🚗 Corredor (10⁹ ganados) |

**VIP** (`DATA.VIP.plans`): 30 d = **12 USDT** (0,400/día) · 60 d = **22** (0,367) · 90 d = **30** (0,333).
Reparto de cada pago: **30 % → reserva del swap** (`swapPoolBps 3000`) y **70 % → tesorería**, 0 % quema.

**Sostenibilidad**: `global_daily_cap_usdt ≤ 0,5 × 0,30 × ingresos VIP del mes / 30`
⟹ ≈ 209 / 228 / 250 pases VIP activos por mes según plan (≈ 418–438 con colchón del 50 %).

---

## 6. Cómo construir y probar

```bash
cd /home/user/vice-idle

node tools/build.js          # regenera vice-idle.html (autocontenido)
node tools/shots.js          # capturas en screenshots/ (login EN/ES/PT, juego, móvil)

node tools/playtest2.js      # 18  reglas del juego
node tools/playtest3.js      # 25  página de login y cuentas
node tools/playtest4.js      # 24  Cambio local, vouchers y referidos
node tools/playtest5.js      # 35  presupuesto por rango, puerta de rango, referidos
node tools/playtest6.js      # 13  i18n (7 pestañas × 3 idiomas)
node tools/playtest7.js      # 12  planes VIP y reparto 30/70
node tools/playtest8.js      # 25  puente Supabase (proyecto simulado)
node tools/playtest9.js      # 11  integración real cliente→HTTP→Postgres (si hay Postgres)

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

## 8. Supabase (v4.5) — opcional, ya integrado

Proyecto del usuario: **VICE IDLE EMPIRE**, ref `esvjifgxdlqwlklwcgde`
(`https://esvjifgxdlqwlklwcgde.supabase.co`). **El agente no entra al dashboard** (no se usan
contraseñas reales). El usuario hace 3 pasos:

1. **SQL Editor** → pegar `supabase/schema.sql` → Run (idempotente).
2. **Project Settings → API** → copiar *Project URL* + clave *anon public*.
3. En el juego: **⚙️ Ajustes → ☁️ Base de datos y nube** → pegar → **Guardar conexión**.

| Objeto | Para qué |
|---|---|
| `players` | `name`, `balance`, `total_earned`, `rank_index`, `vip_until`, `last_seen`, `sync_count` |
| `player_visits` | cada ingreso (`register` / `login`) |
| `player_sync()` / `player_get()` | `SECURITY DEFINER`; la tabla **no** es legible con la anon key |
| `leaderboard`, `game_stats` | vistas de solo lectura |

Subida automática cada ~25 s si hay cambios, al salir y con *Subir ahora*;
**Restaurar desde la nube** y **Vincular dispositivo** (pegar el ID) para otro equipo.

Verificación rápida: `node tools/check-cloud.js --url https://… --key "eyJ…"`.

> **Límite conocido y aceptado:** es un **marcador**, no un libro contable. Con la clave pública
> se puede inflar un balance; el dinero sigue protegido por el contrato (voucher + topes on-chain).
> Cerrarlo requeriría una **Edge Function con Auth** que valide producción antes de escribir.

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

1. **Probar en el proyecto real** el esquema (los tests usan Postgres/simulación) y ajustar si Supabase limita algo.
2. **Anti-cheat del balance**: Edge Function con Auth + validación de producción (sustituye `player_sync` público).
3. **Ranking en el juego**: pestaña con `leaderboard` (ya existe la vista).
4. **Recuperar cuenta en otro dispositivo** sin copiar UUID a mano (código de 6 caracteres tipo referido).
5. **Auditoría externa** de contratos + multisig/timelock para admin y relayer antes de mainnet.
6. **Contenido**: más negocios/misiones y eventos temporales, manteniendo el presupuesto diario.
7. **Añadir idioma** = un objeto más en `src/i18n.js` (463 claves) sin tocar el resto.

---

## 11. Cómo quiero que trabajes

- Explica **qué vas a hacer y por qué** antes de tocar código; luego ejecuta y **enseña resultados**.
- Cambios **pequeños y verificados**: editar → `node --check` → `node tools/build.js` → playtests.
- Si algo no se puede (acceso a servicios con contraseña, red externa), **dilo claro** y ofrece la alternativa segura.
- Al terminar, resume en español: qué cambió, qué se probó (números), dónde está el artefacto.
