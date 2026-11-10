/* =====================================================================
 * VICE IDLE · NEON EMPIRE — js/auth.js
 * Página de login a pantalla completa + cuentas locales.
 *
 * Contraseñas: PBKDF2-SHA256, 120 000 iteraciones, sal de 16 B.
 * Sin crypto.subtle (iframe sandbox / file://) se degrada a un hash
 * salteado marcado como `weak`; nunca se guarda la contraseña en claro.
 *
 * Una ranura por jugador:
 *   viceIdle_save_v1::<nombre>   (Core)
 *   viceIdle_exchange_v2::<jugador> (Exchange)
 *   viceIdle_accounts_v1         (este módulo, índice de cuentas)
 * ===================================================================== */
(function (root) {
  'use strict';

  var ACCOUNTS_KEY = 'viceIdle_accounts_v1';
  var SESSION_KEY = 'viceIdle_session_v1';
  var PBKDF2_ITER = 120000;
  var SALT_BYTES = 16;
  var USER_RE = /^[A-Za-z0-9_]{3,16}$/;
  var MIN_PASS = 6;

  var subtle = (function () {
    try {
      return (root.crypto && root.crypto.subtle) ? root.crypto.subtle : null;
    } catch (e) { return null; }
  })();

  function nowIso() { return new Date().toISOString(); }

  /* ---------------- almacenamiento (usa Core para el espejo en memoria) ---------------- */
  function K() { return root.Core || {}; }
  function getRaw(k) { return K().lsGet ? K().lsGet(k) : null; }
  function setRaw(k, v) { return K().lsSet ? K().lsSet(k, v) : false; }
  function delRaw(k) { if (K().lsDel) K().lsDel(k); }

  function readAccounts() {
    var raw = getRaw(ACCOUNTS_KEY);
    if (!raw) return {};
    try {
      var o = JSON.parse(raw);
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }

  function writeAccounts(obj) { return setRaw(ACCOUNTS_KEY, JSON.stringify(obj)); }

  /* ---------------- utilidades binarias ---------------- */
  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
    return out;
  }

  function randomBytes(n) {
    var arr = new Uint8Array(n);
    if (root.crypto && root.crypto.getRandomValues) {
      root.crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }

  /** Hash rápido de respaldo (solo si no hay crypto.subtle). Marcado `weak`. */
  function fallbackHash(pass, saltHex) {
    var s = saltHex + '|' + pass;
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var round = 0; round < 5000; round++) {
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i) + round;
        h1 = (h1 ^ c) >>> 0;
        h1 = (h1 * 16777619) >>> 0;
        h2 = ((h2 << 5) - h2 + c) >>> 0;
        h2 = (h2 ^ (h1 >>> 13)) >>> 0;
      }
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  /** Derivación de contraseña. Devuelve { hash, salt, algo, weak }. */
  function derive(pass, saltHex) {
    var salt = saltHex || bytesToHex(randomBytes(SALT_BYTES));
    if (!subtle) {
      return Promise.resolve({ hash: fallbackHash(pass, salt), salt: salt, algo: 'fallback-5000', weak: true });
    }
    var enc = new root.TextEncoder();
    var keyMaterial = subtle.importKey('raw', enc.encode(pass), { name: 'PBKDF2' }, false, ['deriveBits']);
    var saltBytes = new Uint8Array(salt.length / 2);
    for (var i = 0; i < saltBytes.length; i++) saltBytes[i] = parseInt(salt.substr(i * 2, 2), 16);
    return keyMaterial.then(function (km) {
      return subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITER, hash: 'SHA-256' }, km, 256);
    }).then(function (bits) {
      return { hash: bytesToHex(new Uint8Array(bits)), salt: salt, algo: 'PBKDF2-SHA256/' + PBKDF2_ITER, weak: false };
    }).catch(function () {
      return { hash: fallbackHash(pass, salt), salt: salt, algo: 'fallback-5000', weak: true };
    });
  }

  /** Comparación en tiempo constante. */
  function constantEq(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /* ---------------- API de cuentas ---------------- */

  function normalizeUser(name) {
    return String(name || '').trim().replace(/\s+/g, '_');
  }

  function validate(name, pass) {
    var u = normalizeUser(name);
    if (!USER_RE.test(u)) return { ok: false, code: 'errUserShort' };
    if (typeof pass !== 'string' || pass.length < MIN_PASS) return { ok: false, code: 'errPassShort' };
    return { ok: true, user: u };
  }

  function exists(name) {
    var accounts = readAccounts();
    return Object.prototype.hasOwnProperty.call(accounts, normalizeUser(name).toLowerCase());
  }

  /**
   * Crea una cuenta local.
   * @returns Promise<{ok, user, weak?, code?}>
   */
  function register(name, pass) {
    var v = validate(name, pass);
    if (!v.ok) return Promise.resolve({ ok: false, code: v.code });
    var key = v.user.toLowerCase();
    var accounts = readAccounts();
    if (accounts[key]) return Promise.resolve({ ok: false, code: 'errExists' });
    return derive(pass).then(function (d) {
      accounts = readAccounts(); // re-lee por si cambió mientras derivaba
      if (accounts[key]) return { ok: false, code: 'errExists' };
      accounts[key] = {
        user: v.user,
        salt: d.salt,
        hash: d.hash,
        algo: d.algo,
        weak: !!d.weak,
        createdAt: nowIso(),
        lastLogin: null,
        logins: 0
      };
      writeAccounts(accounts);
      return { ok: true, user: v.user, weak: !!d.weak };
    });
  }

  /**
   * Inicia sesión con una cuenta local.
   * @returns Promise<{ok, user, weak?, code?}>
   */
  function login(name, pass) {
    var user = normalizeUser(name);
    var accounts = readAccounts();
    var rec = accounts[user.toLowerCase()];
    if (!rec) return Promise.resolve({ ok: false, code: 'errNotFound' });
    return derive(pass, rec.salt).then(function (d) {
      if (!constantEq(d.hash, rec.hash)) return { ok: false, code: 'errWrongPass' };
      accounts = readAccounts();
      var r2 = accounts[user.toLowerCase()];
      if (r2) {
        r2.lastLogin = nowIso();
        r2.logins = (r2.logins || 0) + 1;
        writeAccounts(accounts);
      }
      return { ok: true, user: rec.user, weak: !!rec.weak };
    });
  }

  /** Cambia la contraseña de la cuenta activa. */
  function changePassword(user, oldPass, newPass) {
    var u = normalizeUser(user).toLowerCase();
    var accounts = readAccounts();
    var rec = accounts[u];
    if (!rec) return Promise.resolve({ ok: false, code: 'errNotFound' });
    if (typeof newPass !== 'string' || newPass.length < MIN_PASS) return Promise.resolve({ ok: false, code: 'errPassShort' });
    return derive(oldPass, rec.salt).then(function (d) {
      if (!constantEq(d.hash, rec.hash)) return { ok: false, code: 'errWrongPass' };
      return derive(newPass).then(function (nd) {
        accounts = readAccounts();
        var r2 = accounts[u];
        if (!r2) return { ok: false, code: 'errNotFound' };
        r2.salt = nd.salt;
        r2.hash = nd.hash;
        r2.algo = nd.algo;
        r2.weak = !!nd.weak;
        r2.changedAt = nowIso();
        writeAccounts(accounts);
        return { ok: true };
      });
    });
  }

  /** Borra la cuenta y su partida + su libro del cambio. */
  function deleteAccount(user) {
    var u = normalizeUser(user).toLowerCase();
    var accounts = readAccounts();
    var rec = accounts[u];
    if (!rec) return { ok: false, code: 'errNotFound' };
    delete accounts[u];
    writeAccounts(accounts);
    if (K().lsDel) {
      K().lsDel('viceIdle_save_v1::' + rec.user);
      K().lsDel('viceIdle_exchange_v2::' + rec.user);
    }
    clearSession();
    return { ok: true };
  }

  /* ---------------- sesión ---------------- */

  function saveSession(obj) {
    return setRaw(SESSION_KEY, JSON.stringify(Object.assign({ at: Date.now() }, obj)));
  }

  function readSession() {
    var raw = getRaw(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function clearSession() { delRaw(SESSION_KEY); }

  /** Sesión válida (nombre + invitado) o null. */
  function session() {
    var s = readSession();
    if (!s || !s.name) return null;
    if (s.guest) return { name: s.name, guest: true };
    var accounts = readAccounts();
    var rec = accounts[String(s.name).toLowerCase()];
    if (!rec) return null;
    return { name: rec.user, guest: false, weak: !!rec.weak };
  }

  /* ---------------- UI (página de login) ---------------- */

  var el = {};      // referencias DOM
  var mode = 'login'; // login | register | guest
  var busy = false;
  var onGuestCounter = 0;

  function $(id) { return document.getElementById(id); }

  function setMsg(text, kind) {
    if (!el.msg) return;
    el.msg.textContent = text || '';
    el.msg.className = 'login-msg' + (kind === 'ok' ? ' ok' : '');
  }

  function setMode(next) {
    mode = next;
    if (!el.tabs) return;
    Array.prototype.forEach.call(el.tabs.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === next);
    });
    var isGuest = next === 'guest';
    if (el.userField) el.userField.style.display = isGuest ? 'none' : '';
    if (el.passField) el.passField.style.display = isGuest ? 'none' : '';
    if (el.pass2Field) el.pass2Field.classList.toggle('hidden', next !== 'register');
    if (el.pass) el.pass.autocomplete = next === 'register' ? 'new-password' : 'current-password';
    if (el.submit) {
      el.submit.textContent = root.I18n.t(
        next === 'register' ? 'login.create' : (isGuest ? 'login.guest' : 'login.enter')
      );
    }
    var t = root.I18n.t;
    if (el.title) el.title.textContent = t(isGuest ? 'login.welcome' : 'login.title');
    setMsg('');
    if (isGuest && el.user) el.user.value = '';
  }

  function setLang(lang) {
    root.I18n.set(lang);
    if (el.lang) {
      Array.prototype.forEach.call(el.lang.querySelectorAll('button'), function (b) {
        b.classList.toggle('active', b.getAttribute('data-lang') === lang);
      });
    }
    root.I18n.apply(document);
    // los textos dinámicos dependen del modo
    setMode(mode);
    if (root.UI && root.UI.onLangChange) root.UI.onLangChange(lang);
  }

  function show() {
    if (el.root) el.root.hidden = false;
    document.body.classList.add('locked');
    if (el.user) setTimeout(function () { try { el.user.focus(); } catch (e) { /* ignore */ } }, 60);
  }

  function hide() {
    if (el.root) el.root.hidden = true;
    document.body.classList.remove('locked');
  }

  function guestName() {
    onGuestCounter++;
    var base = 'guest';
    var n = 1;
    while (exists(base + n)) n++;
    return base + Math.max(1, n + onGuestCounter - 1);
  }

  /** Arranca la partida para un usuario ya validado. */
  function startGame(name, isGuest, remember) {
    if (remember === false) {
      clearSession();
    }
    saveSession({ name: name, guest: !!isGuest });
    hide();
    if (root.Main && root.Main.startGame) root.Main.startGame(name, { guest: !!isGuest });
  }

  function submit(ev) {
    if (ev) ev.preventDefault();
    if (busy) return;
    var i18n = root.I18n;
    if (mode === 'guest') {
      busy = true;
      var gname = guestName();
      busy = false;
      startGame(gname, true, el.remember ? el.remember.checked : true);
      return;
    }
    var user = el.user ? el.user.value : '';
    var pass = el.pass ? el.pass.value : '';
    var pass2 = el.pass2 ? el.pass2.value : '';
    if (mode === 'register' && pass !== pass2) {
      setMsg(i18n.t('login.errPassMismatch'));
      return;
    }
    var v = validate(user, pass);
    if (!v.ok) { setMsg(i18n.t('login.' + v.code)); return; }
    busy = true;
    if (el.submit) el.submit.disabled = true;
    setMsg(i18n.t(mode === 'register' ? 'login.creating' : 'login.entering'), 'ok');
    var op = mode === 'register' ? register(user, pass) : login(user, pass);
    op.then(function (res) {
      busy = false;
      if (el.submit) el.submit.disabled = false;
      if (!res.ok) {
        setMsg(i18n.t('login.' + (res.code || 'errGeneric')));
        return;
      }
      if (res.weak) {
        setMsg(i18n.t('login.weakWarn'), 'ok');
        setTimeout(function () {
          startGame(res.user, false, el.remember ? el.remember.checked : true);
        }, 700);
        return;
      }
      startGame(res.user, false, el.remember ? el.remember.checked : true);
    }).catch(function (err) {
      busy = false;
      if (el.submit) el.submit.disabled = false;
      if (root.console) console.error('[auth]', err);
      setMsg(i18n.t('login.errGeneric'));
    });
  }

  /** Punto de arranque de la UI de login. */
  function boot() {
    el.root = $('loginRoot');
    el.tabs = $('loginTabs');
    el.user = $('loginUser');
    el.pass = $('loginPass');
    el.pass2 = $('loginPass2');
    el.passField = $('passField');
    el.pass2Field = $('pass2Field');
    el.userField = el.user ? el.user.closest('.field') : null;
    el.msg = $('loginMsg');
    el.submit = $('loginSubmit');
    el.title = $('loginTitle');
    el.lang = $('loginLang');
    el.remember = $('loginRemember');
    el.form = $('loginForm');

    if (el.tabs) {
      el.tabs.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-mode]');
        if (b) setMode(b.getAttribute('data-mode'));
      });
    }
    if (el.lang) {
      el.lang.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-lang]');
        if (b) setLang(b.getAttribute('data-lang'));
      });
    }
    if (el.form) el.form.addEventListener('submit', submit);

    // idioma inicial
    setLang(root.I18n.lang);

    // sesión previa → entra directo
    var s = session();
    if (s) {
      hide();
      if (root.Main && root.Main.startGame) root.Main.startGame(s.name, { guest: s.guest });
      return true;
    }
    show();
    return false;
  }

  var Auth = {
    ACCOUNTS_KEY: ACCOUNTS_KEY,
    SESSION_KEY: SESSION_KEY,
    PBKDF2_ITER: PBKDF2_ITER,
    MIN_PASS: MIN_PASS,
    USER_RE: USER_RE,
    secure: !!subtle,
    boot: boot,
    show: show,
    hide: hide,
    session: session,
    clearSession: clearSession,
    register: register,
    login: login,
    changePassword: changePassword,
    deleteAccount: deleteAccount,
    exists: exists,
    normalizeUser: normalizeUser,
    validate: validate,
    derive: derive,
    accounts: readAccounts,
    logout: function () { clearSession(); root.location.reload(); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Auth;
  root.Auth = Auth;
})(typeof window !== 'undefined' ? window : globalThis);
