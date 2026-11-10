/* =====================================================================
 * VICE IDLE · NEON EMPIRE — js/main.js
 * Arranque en este orden exacto:
 *   i18n.init → Auth.boot → (login o sesión) → Core.load → UI.mount → Cloud.start
 * El juego NO se renderiza hasta que hay jugador (body.locked).
 * ===================================================================== */
(function (root) {
  'use strict';

  var started = false;
  var tickTimer = null;

  function applyDefaultCloud() {
    // El build puede inyectar la conexión por defecto (clave anon public).
    // Nunca sobrescribe una conexión guardada por el jugador.
    var d = root.VICE_CLOUD_DEFAULT;
    if (!d || !d.key) return;
    var cur = root.Cloud.loadConf();
    if (cur && cur.enabled && cur.key) return;
    var v = root.Cloud.validateConfig(d.url || '.', d.key);
    if (v.ok) {
      root.Cloud.saveConf({ url: v.url, key: v.key, auto: true, enabled: true });
      root.Cloud.setApiMode(d.mode || 'vice');
    }
  }

  /**
   * Arranca la partida de un jugador ya autenticado.
   * @param {string} name
   * @param {{guest?:boolean}} opts
   */
  function startGame(name, opts) {
    if (started) return root.Core.state;
    started = true;
    var o = opts || {};
    root.Core.bootstrap(name, { guest: !!o.guest });
    // guarda de "volviste": primero presupuesto del día, luego offline
    root.Core.ensureToday();
    root.Core.applyOffline();
    root.Core.checkAchievements();
    root.UI.mount();
    applyDefaultCloud();
    try {
      root.Cloud.start();
    } catch (e) {
      if (root.console) console.warn('[cloud] no se pudo arrancar', e);
    }
    // tick principal
    if (tickTimer) root.clearInterval(tickTimer);
    tickTimer = root.setInterval(function () {
      root.Core.tick(root.Core.TICK_MS);
    }, root.Core.TICK_MS);
    root.Core.save('boot');
    return root.Core.state;
  }

  function boot() {
    root.I18n.init();
    root.I18n.apply(document);
    // Auth.boot devuelve true si había sesión y ya arrancó el juego
    var hadSession = root.Auth.boot();
    if (!hadSession) {
      // la página de login queda visible y bloquea el juego
      root.I18n.apply(document.getElementById('loginRoot'));
    }
  }

  // expuesto para tests y para Auth
  root.Main = { boot: boot, startGame: startGame, get started() { return started; } };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
