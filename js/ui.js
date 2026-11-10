/* =====================================================================
 * VICE IDLE · NEON EMPIRE — js/ui.js
 * Render del juego, modales, sonido (WebAudio), partículas y toasts.
 * Todo el DOM vive aquí; la lógica está en Core/Exchange/Cloud.
 * ===================================================================== */
(function (root) {
  'use strict';

  var D = root.DATA;
  var E = root.Economy;
  var t = function (k, v) { return root.I18n.t(k, v); };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- formateo de números ---------------- */
  var SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

  function fmt(n, dec) {
    var v = Number(n) || 0;
    if (v < 0) return '-' + fmt(-v, dec);
    var digits = dec === undefined ? 2 : dec;
    if (v < 1000) {
      return v < 10 ? (Math.round(v * 100) / 100).toFixed(v % 1 === 0 ? 0 : Math.min(digits, 2))
                    : Math.round(v).toString();
    }
    var tier = Math.floor(Math.log10(v) / 3);
    if (tier >= SUFFIX.length) return v.toExponential(2).replace('e+', 'e');
    var scaled = v / Math.pow(1000, tier);
    return scaled.toFixed(scaled < 10 ? 2 : (scaled < 100 ? 1 : 0)) + SUFFIX[tier];
  }

  function fmtUsdt(n) {
    var v = Number(n) || 0;
    return v.toFixed(v < 1 ? 3 : 2);
  }

  function fmtGreed(n) { return fmt(n) + ' ' + t('unit.greed'); }

  function pct(n) { return Math.round((Number(n) || 0) * 100) + '%'; }

  function timeLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60) + 's';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }

  /* ---------------- sonido (WebAudio, sin ficheros) ---------------- */
  var audio = { ctx: null, master: null, on: true };

  function audioInit() {
    if (audio.ctx) return audio.ctx;
    try {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return null;
      audio.ctx = new Ctx();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.16;
      audio.master.connect(audio.ctx.destination);
    } catch (e) { audio.ctx = null; }
    return audio.ctx;
  }

  function beep(freq, ms, type, gain) {
    if (!audio.on) return;
    var ctx = audioInit();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'triangle';
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(gain === undefined ? 0.5 : gain, ctx.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ms || 120) / 1000);
      o.connect(g); g.connect(audio.master);
      o.start(); o.stop(ctx.currentTime + (ms || 120) / 1000 + 0.02);
    } catch (e) { /* sin audio, sin drama */ }
  }

  var sfx = {
    tap: function () { beep(420 + Math.random() * 90, 70, 'square', 0.22); },
    buy: function () { beep(520, 90, 'triangle', 0.4); setTimeout(function () { beep(780, 110, 'triangle', 0.35); }, 55); },
    upgrade: function () { beep(640, 110, 'sawtooth', 0.3); setTimeout(function () { beep(960, 140, 'sine', 0.3); }, 70); },
    reward: function () { [660, 880, 1100].forEach(function (f, i) { setTimeout(function () { beep(f, 120, 'sine', 0.3); }, i * 70); }); },
    error: function () { beep(180, 160, 'square', 0.28); },
    raid: function () {
      [220, 180, 140].forEach(function (f, i) { setTimeout(function () { beep(f, 180, 'sawtooth', 0.35); }, i * 90); });
    },
    levelup: function () { [520, 660, 780, 1040].forEach(function (f, i) { setTimeout(function () { beep(f, 110, 'triangle', 0.3); }, i * 80); }); }
  };

  /* ---------------- toasts ---------------- */
  function toast(msg, kind, icon) {
    var box = $('toasts');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<span class="ic">' + (icon || (kind === 'err' ? '⚠️' : kind === 'warn' ? '⚡' : '✅')) + '</span><span></span>';
    el.lastChild.textContent = msg;
    box.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, kind === 'err' ? 4200 : 3000);
  }

  /* ---------------- floating numbers ---------------- */
  function floater(x, y, text, color) {
    if (!root.Core.state.prefs.particles) return;
    var layer = $('floaters');
    if (!layer) return;
    var el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (color) el.style.color = color;
    layer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
  }

  /* ---------------- canvas de la ciudad ---------------- */
  var city = { ctx: null, w: 360, h: 220, stars: [], t: 0, raf: null };

  function initCity() {
    var cv = $('cityCanvas');
    if (!cv) return;
    city.ctx = cv.getContext('2d');
    city.w = cv.width; city.h = cv.height;
    city.stars = [];
    for (var i = 0; i < 55; i++) {
      city.stars.push({
        x: Math.random() * city.w, y: Math.random() * city.h * 0.6,
        r: Math.random() * 1.6 + 0.4, a: Math.random()
      });
    }
    drawCity();
  }

  function drawCity() {
    if (!city.ctx || !root.Core || !root.Core.state) { city.raf = root.requestAnimationFrame(drawCity); return; }
    var c = city.ctx, w = city.w, h = city.h;
    var s = root.Core.state;
    var heat = s ? s.heat / E.HEAT_MAX : 0;
    c.clearRect(0, 0, w, h);
    // cielo
    var sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#12042a');
    sky.addColorStop(0.55, heat > 0.5 ? '#3a0820' : '#1a0740');
    sky.addColorStop(1, '#07020f');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    // estrellas
    city.t += 0.016;
    for (var i = 0; i < city.stars.length; i++) {
      var st = city.stars[i];
      var tw = 0.45 + 0.55 * Math.abs(Math.sin(city.t * 1.4 + st.a * 6.28));
      c.globalAlpha = tw * 0.85;
      c.fillStyle = '#d7c9ff';
      c.beginPath(); c.arc(st.x, st.y, st.r, 0, 6.284); c.fill();
    }
    c.globalAlpha = 1;
    // edificios
    var seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var x = 0;
    while (x < w) {
      var bw = 18 + rnd() * 34;
      var bh = 34 + rnd() * 108;
      var y = h - bh - 12;
      c.fillStyle = '#0d0620';
      c.fillRect(x, y, bw, bh);
      c.strokeStyle = heat > 0.6 ? 'rgba(255,45,149,.55)' : 'rgba(177,75,255,.35)';
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
      // ventanas
      for (var wy = y + 7; wy < y + bh - 5; wy += 9) {
        for (var wx = x + 4; wx < x + bw - 4; wx += 7) {
          if (rnd() > 0.55) {
            c.fillStyle = rnd() > 0.8 ? 'rgba(255,209,102,.85)' : 'rgba(0,240,255,.65)';
            c.fillRect(wx, wy, 3, 4);
          }
        }
      }
      x += bw + 3;
    }
    // neón del suelo
    var glow = c.createLinearGradient(0, h - 16, 0, h);
    glow.addColorStop(0, heat > 0.6 ? 'rgba(255,45,149,.55)' : 'rgba(177,75,255,.45)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, h - 16, w, 16);
    city.raf = root.requestAnimationFrame(drawCity);
  }

  function stopCity() { if (city.raf) root.cancelAnimationFrame(city.raf); city.raf = null; }

  /* ---------------- render principal ---------------- */
  var currentTab = 'empire';
  var lastRender = 0;

  function renderAll() {
    renderHud();
    renderTab(currentTab, true);
    renderTopbar();
  }

  function renderTopbar() {
    if (!root.Core || !root.Core.state) return;
    var s = root.Core.state;
    var who = $('whoName');
    if (who) who.textContent = root.Core.player.name;
    var rp = $('rankPill');
    if (rp) {
      var r = root.Core.rank();
      rp.textContent = r.emoji + ' ' + t('rank.name.' + r.index);
    }
    var vipPill = $('vipPill');
    if (vipPill) vipPill.classList.toggle('hidden', !root.Core.isVip());
    var gp = $('guestPill');
    if (gp) gp.classList.toggle('hidden', !root.Core.player.guest);
    var cp = $('cloudPill');
    if (cp) {
      var on = root.Cloud && root.Cloud.configured();
      cp.textContent = on ? '☁ ✓' : '☁ —';
      cp.className = 'pill' + (on ? ' cloud-on' : '');
    }
    var fb = $('footBuild');
    if (fb) fb.textContent = t('footer.build') + ' ' + D.version;
  }

  function renderHud() {
    if (!root.Core || !root.Core.state) return;
    var s = root.Core.state;
    var cash = $('hudCash'); if (cash) cash.textContent = fmt(s.cash);
    var inc = $('hudIncome');
    var eff = root.Core.effectiveRenta();
    if (inc) inc.textContent = fmt(eff) + ' ' + t('unit.greed') + t('unit.perSec');
    var incSub = $('hudIncomeSub');
    if (incSub) {
      var nominal = root.Core.rentaPerSec();
      incSub.textContent = nominal > 0 && eff < nominal * 0.999
        ? '−' + Math.round((1 - eff / nominal) * 100) + '% (' + t('hud.heat') + ')'
        : t('biz.perSec');
    }
    var heatV = $('hudHeat'); if (heatV) heatV.textContent = Math.round(s.heat) + '%';
    var heatBar = $('heatBar'); if (heatBar) heatBar.style.width = (s.heat / E.HEAT_MAX * 100) + '%';
    var glow = $('heatGlow'); if (glow) glow.style.opacity = (s.heat / E.HEAT_MAX * 0.85).toFixed(3);

    var budget = root.Core.ensureBudget();
    var bv = $('hudBudget');
    if (bv) bv.textContent = fmt(budget.left) + ' / ' + fmt(budget.total);
    var bb = $('budgetBar');
    if (bb) bb.style.width = Math.max(0, Math.min(100, budget.total > 0 ? budget.left / budget.total * 100 : 0)) + '%';

    var rv = $('hudRank');
    if (rv) {
      var r = root.Core.rank();
      rv.textContent = r.emoji + ' ' + t('rank.name.' + r.index);
    }
    var rb = $('rankBar');
    if (rb) {
      var idx = root.Core.rankIndex();
      var cur = E.RANKS[idx];
      var next = E.RANKS[idx + 1];
      var p = next ? Math.max(0, Math.min(1, (s.totalEarned - cur.threshold) / (next.threshold - cur.threshold))) : 1;
      rb.style.width = (p * 100) + '%';
    }
    var trickle = $('hudTrickle');
    if (trickle) trickle.classList.toggle('hidden', budget.left > 0);

    var cc = $('comboChip');
    if (cc) {
      var onCombo = s.combo > 1.001;
      cc.classList.toggle('on', onCombo);
      cc.textContent = 'x' + s.combo.toFixed(2);
    }
    var ec = $('eventChip');
    if (ec) {
      var ev = activeEvent();
      ec.classList.toggle('hidden', !ev);
      if (ev) ec.textContent = '⚡ ' + t(ev.key) + ' x' + ev.multiplier.toFixed(2) + ' · ' + timeLeft(ev.endsAt - Date.now());
    }
    var tl = $('tapLabel');
    if (tl) tl.textContent = '+' + fmt(root.Core.clickPower() * s.combo) + ' ' + t('unit.greed');
  }

  function renderTab(tab, force) {
    if (!force && tab !== currentTab) return;
    var now = Date.now();
    if (!force && now - lastRender < 200) return;
    lastRender = now;
    if (tab === 'empire') { renderBiz(); }
    else if (tab === 'upgrades') renderUpgrades();
    else if (tab === 'missions') renderMissions();
    else if (tab === 'withdraw') renderWithdraw();
    else if (tab === 'exchange') renderExchange();
    else if (tab === 'vip') renderVip();
    else if (tab === 'ranking') renderRanking();
    else if (tab === 'profile') renderProfile();
  }

  /* ---------------- negocios ---------------- */
  function renderBiz() {
    var box = $('bizList');
    if (!box || !root.Core || !root.Core.state) return;
    var s = root.Core.state;
    var rankIdx = root.Core.rankIndex();
    var html = '';
    for (var i = 0; i < D.businesses.length; i++) {
      var b = D.businesses[i];
      var owned = root.Core.bizCount(b.id);
      var locked = b.unlockRank > rankIdx;
      var cost = E.upgradeCost(b.baseCost, owned, b.growth);
      var can = !locked && s.cash >= cost;
      var starts = !owned;
      html += '<div class="biz' + (locked ? ' locked' : '') + '" data-biz="' + b.id + '">' +
        '<div class="ico">' + b.emoji + '</div>' +
        '<div>' +
          '<div class="nm">' + t('biz.name.' + b.id) +
            (owned ? ' <span class="qty">×' + owned + '</span>' : '') +
          '</div>' +
          '<div class="ds">' + (locked ? t('biz.lockedHint', { rank: t('rank.name.' + b.unlockRank) }) : t('biz.desc.' + b.id)) + '</div>' +
          (owned || !locked ? '<div class="prod">' + fmt(owned * b.baseIncome * root.Core.upgradeMul('business', b.id)) + ' ' + t('unit.greed') + t('unit.perSec') + '</div>' : '') +
        '</div>' +
        '<div class="act">' +
          '<button class="buy-btn" data-buy="' + b.id + '" data-mode="1"' + (can || owned ? '' : ' disabled') + '>' +
            '<span class="c">' + (locked ? t('biz.locked') : fmt(cost)) + '</span>' +
            '<span class="q">' + (starts ? t('biz.buy') : t('biz.buy')) + '</span>' +
          '</button>' +
          (owned ? '<button class="btn btn-sm" data-buy="' + b.id + '" data-mode="10"' + (s.cash >= E.bulkCost(b.baseCost, owned, 10, b.growth) ? '' : ' disabled') + '>×10</button>' +
                   '<button class="btn btn-sm" data-buy="' + b.id + '" data-mode="max"' + (s.cash >= cost ? '' : ' disabled') + '>MAX</button>' : '') +
        '</div>' +
      '</div>';
    }
    box.innerHTML = html;
  }

  /* ---------------- mejoras ---------------- */
  function renderUpgrades() {
    var box = $('upgList');
    if (!box || !root.Core || !root.Core.state) return;
    var s = root.Core.state;
    var html = '';
    for (var i = 0; i < D.upgrades.length; i++) {
      var u = D.upgrades[i];
      var lvl = root.Core.upgradeLevel(u.id);
      var maxed = lvl >= u.maxLevel;
      var cost = E.upgradeCost(u.baseCost, lvl, u.growth);
      var can = !maxed && s.cash >= cost;
      var eff = u.kind === 'heat' ? (1 - u.effect) * 100 + '%' : '+' + Math.round((u.effect - 1) * 100) + '%';
      html += '<div class="card' + (maxed ? ' maxed' : '') + '">' +
        '<div class="top"><span class="ico">' + (u.kind === 'click' ? '👆' : u.kind === 'heat' ? '🕶️' : u.kind === 'budget' ? '📈' : u.kind === 'global' ? '🌐' : '✨') + '</span>' +
          '<span class="nm">' + t('upg.name.' + u.id) + '</span>' +
          '<span class="tag">' + t('upg.kind.' + u.kind) + '</span></div>' +
        '<div class="desc">' + t('upg.desc.' + u.id) + '</div>' +
        '<div class="eff">' + eff + ' · ' + t('upg.level') + ' ' + lvl + '/' + u.maxLevel + '</div>' +
        '<div class="foot"><button class="btn ' + (can ? 'btn-primary' : '') + ' btn-sm" data-upg="' + u.id + '"' + (can ? '' : ' disabled') + '>' +
          (maxed ? t('upg.maxed') : fmt(cost) + ' ' + t('unit.greed')) + '</button></div>' +
      '</div>';
    }
    box.innerHTML = html;
  }

  /* ---------------- misiones ---------------- */
  function renderMissions() {
    var box = $('misList');
    if (!box || !root.Core || !root.Core.state) return;
    var s = root.Core.state;
    root.Core.ensureToday();
    var list = s.missions.list || [];
    var html = '';
    var ICONS = { clicks: '👆', buy: '🛒', upgrade: '⬆️', earn: '💰', heat: '🔥', swap: '🔁', combo: '⚡', prestige: '♻️' };
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      var m = D.missions.filter(function (x) { return x.id === id; })[0];
      if (!m) continue;
      var prog = root.Core.missionProgress(id);
      var done = prog >= m.target;
      var claimed = !!s.missions.claimed[id];
      html += '<div class="mis-row' + (done ? ' done' : '') + (claimed ? ' claimed' : '') + '">' +
        '<div class="ico">' + (ICONS[m.type] || '🎯') + '</div>' +
        '<div><div class="t">' + t('mis.title.' + id) + '</div>' +
          '<div class="p">' + t('mis.progress') + ': ' + fmt(Math.min(prog, m.target)) + ' / ' + fmt(m.target) + '</div>' +
          '<div class="mini-bar"><i style="width:' + Math.min(100, prog / m.target * 100) + '%"></i></div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div class="rew">' + fmt(m.reward) + ' ' + t('unit.greed') + '</div>' +
          '<button class="btn btn-sm ' + (done && !claimed ? 'btn-cyan' : '') + '" data-mission="' + id + '"' +
            (done && !claimed ? '' : ' disabled') + '>' + (claimed ? t('mis.claimed') : t('mis.claim')) + '</button>' +
        '</div>' +
      '</div>';
    }
    box.innerHTML = html;
    var reset = $('misReset');
    if (reset) reset.textContent = t('mis.resetIn') + ' ' + timeLeft(root.Core.utcDayEnd() - Date.now());
  }

  /* ---------------- cambio ---------------- */
  function renderExchange() {
    var panel = $('swRates');
    if (!panel || !root.Core || !root.Core.state) return;
    var sum = root.Exchange.summary();
    var ep = sum.epoch;
    panel.innerHTML =
      '<span class="k">' + t('sw.rate') + '</span><span class="v">' + fmt(ep.rate, 0) + ' ' + t('unit.greed') + ' = 1 ' + t('unit.usdt') + '</span>' +
      '<span class="k">' + t('sw.epoch') + '</span><span class="v">#' + ep.epoch + ' · ' + ep.daysLeft + 'd</span>' +
      '<span class="k">' + t('sw.min') + '</span><span class="v">' + fmtUsdt(ep.minUsdt) + ' ' + t('unit.usdt') + '</span>' +
      '<span class="k">' + t('sw.capPlayer') + '</span><span class="v">' + fmtUsdt(sum.usedToday) + ' / ' + fmtUsdt(sum.playerCap) + ' ' + t('unit.usdt') + '</span>' +
      '<span class="k">' + t('sw.capGlobal') + '</span><span class="v">' + fmtUsdt(sum.global.left) + ' / ' + fmtUsdt(sum.global.cap) + '</span>';
    var btn = $('swRequest');
    var amt = $('swAmount');
    if (btn) btn.disabled = !sum.rankOk;
    var pend = $('swPending');
    if (pend) pend.classList.toggle('hidden', !sum.pending);
    if (sum.pending) {
      var p = sum.pending;
      var apply = $('swApply');
      if (apply) apply.disabled = p.status !== 'pending';
      var claim = $('swClaim');
      if (claim) claim.disabled = p.status !== 'signed';
      var paste = $('swVoucher');
      if (paste && p.status !== 'pending') paste.value = p.voucher ? JSON.stringify(p.voucher) : paste.value;
    }
    if (amt) {
      var g = Number(String(amt.value).replace(/[^0-9]/g, ''));
      var q = $('swQuote');
      if (q) q.textContent = g > 0 && ep.rate > 0 ? fmtUsdt(g / ep.rate) + ' ' + t('unit.usdt') : '—';
    }
    var hist = $('swHistory');
    if (hist) {
      if (!sum.history.length) hist.textContent = t('sw.empty');
      else {
        var h = '<table class="tbl"><tbody>';
        for (var i = 0; i < Math.min(sum.history.length, 12); i++) {
          var e = sum.history[i];
          h += '<tr><td>' + new Date(e.createdAt).toLocaleDateString() + '</td>' +
            '<td class="num">' + fmt(e.greed) + ' G$</td>' +
            '<td class="num">' + fmtUsdt(e.usdt) + ' USDT</td>' +
            '<td>' + t('sw.status.' + e.status) + '</td></tr>';
        }
        hist.innerHTML = h + '</tbody></table>';
      }
    }
  }


  /* ---------------- retiros ---------------- */
  function renderWithdraw() {
    if (!root.Core || !root.Core.state) return;
    var g = root.Exchange.gate();
    var sum = root.Exchange.summary();
    var pill = $('wdGatePill');
    if (pill) {
      pill.textContent = (g.open ? '✅ ' + t('wd.gateOpen') : '🔒 ' + t('wd.gateClosed')) +
        (g.byVip ? ' · VIP' : '');
      pill.className = 'pill' + (g.open ? ' cloud-on' : '');
    }

    var box = $('wdGate');
    if (box) {
      var p = (g.current + 1 < E.RANKS.length)
        ? Math.max(0, Math.min(1, (root.Core.state.totalEarned - E.RANKS[g.current].threshold) /
            (E.RANKS[g.current + 1].threshold - E.RANKS[g.current].threshold)))
        : 1;
      var html = '';
      if (g.open) {
        html += '<div class="notice ok">✅ ' + t('wd.gateOpen') + (g.byVip
          ? ' · ' + t('wd.gateVipActive')
          : ' · ' + t('wd.gateRequired', { rank: t(g.minRankKey) })) + '</div>';
      } else {
        html += '<div class="notice danger">🔒 ' + t('wd.gateRequired', { rank: t(g.minRankKey) }) + '</div>';
        html += '<div class="notice warn">⭐ ' + t('wd.gateVipHint') + '</div>';
      }
      html += '<div class="section-head" style="margin:12px 0 6px"><p>' +
        t('wd.gateProgress', { rank: t('rank.name.' + Math.min(g.current + 1, E.RANKS.length - 1)) }) + '</p></div>';
      html += '<div class="mini-bar" style="height:9px"><i style="width:' + (p * 100) + '%"></i></div>';
      html += '<div class="kv" style="margin-top:10px">' +
        '<span class="k">' + t('hud.rank') + '</span><span class="v">' + t('rank.name.' + g.current) + '</span>' +
        '<span class="k">' + t('ui.total') + '</span><span class="v">' + fmt(root.Core.state.totalEarned) + ' ' + t('unit.greed') + '</span>' +
        '<span class="k">' + t('vip.active') + '</span><span class="v">' +
          (root.Core.isVip() ? new Date(root.Core.state.vipUntil).toLocaleDateString() : t('vip.inactive')) + '</span>' +
      '</div>';
      box.innerHTML = html;
    }

    var net = $('wdNet');
    var amount = 0;
    var amtEl = $('swAmount');
    if (amtEl) amount = Number(String(amtEl.value || '').replace(/[^0-9]/g, ''));
    var usdt = amount > 0 && sum.epoch.rate > 0 ? amount / sum.epoch.rate : 0;
    if (net) net.textContent = usdt > 0 ? fmtUsdt(usdt) + ' ' + t('unit.usdt') : '—';
    var cap = $('wdCap');
    if (cap) cap.textContent = fmtUsdt(sum.usedToday) + ' / ' + fmtUsdt(sum.playerCap) + ' ' + t('unit.usdt');

    var rules = $('wdRules');
    if (rules) {
      var gd = D.swap;
      rules.innerHTML =
        '<span class="k">1</span><span class="v">' + t('wd.rule1', { min: fmtUsdt(gd.minUsdt) }) + '</span>' +
        '<span class="k">2</span><span class="v">' + t('wd.rule2', { cap: fmtUsdt(gd.playerDailyCapUsdt) }) + '</span>' +
        '<span class="k">3</span><span class="v">' + t('wd.rule3', { global: fmtUsdt(gd.globalDailyCapUsdt) }) + '</span>' +
        '<span class="k">4</span><span class="v">' + t('wd.rule4', { rank: t('rank.name.' + gd.minRankIndex) }) + '</span>' +
        '<span class="k">5</span><span class="v">' + t('wd.rule5') + '</span>' +
        '<span class="k">' + t('sw.rate') + '</span><span class="v">' + fmt(sum.epoch.rate, 0) + ' ' + t('unit.greed') + ' = 1 ' + t('unit.usdt') + '</span>' +
        '<span class="k">' + t('sw.epoch') + '</span><span class="v">#' + sum.epoch.epoch + ' · ' + sum.epoch.daysLeft + 'd</span>';
    }

    var note = $('wdMethodNote');
    var method = $('wdMethod') ? $('wdMethod').value : 'wallet';
    if (note) {
      note.textContent = method === 'cloud'
        ? (root.Cloud.configured() ? t('wd.cloudHelp') : t('wd.cloudHelp') + ' · ' + t('wd.notConnected'))
        : t('wd.walletHelp');
      note.className = 'notice' + (method === 'cloud' && !root.Cloud.configured() ? ' warn' : '');
    }
    var go = $('wdGo');
    if (go) go.disabled = !g.open;
  }

  /* ---------------- VIP ---------------- */
  function renderVip() {
    var box = $('vipPlans');
    if (!box || !root.Core || !root.Core.state) return;
    var html = '';
    var plans = D.vip.plans;
    var best = plans[plans.length - 1];
    for (var i = 0; i < plans.length; i++) {
      var p = plans[i];
      var perDay = p.priceUsdt / p.days;
      var save = plans[0].priceUsdt / plans[0].days - perDay;
      html += '<div class="vip-plan">' +
        '<div class="d">' + p.days + ' <small>' + t('vip.days') + '</small></div>' +
        '<div class="pr">' + fmtUsdt(p.priceUsdt) + ' <small>USDT</small></div>' +
        '<div class="per">' + fmtUsdt(perDay) + ' USDT ' + t('vip.perDay') + '</div>' +
        (save > 0.001 ? '<div class="save">' + t('vip.savings') + ' ' + Math.round(save / (plans[0].priceUsdt / plans[0].days) * 100) + '%</div>' : '') +
        '<button class="btn btn-primary btn-sm" data-vip="' + i + '">' + t('vip.buy') + '</button>' +
      '</div>';
    }
    box.innerHTML = html;
    var st = $('vipStatus');
    if (st) {
      st.textContent = root.Core.isVip()
        ? '★ ' + t('vip.until') + ' ' + new Date(root.Core.state.vipUntil).toLocaleDateString()
        : t('vip.inactive');
      st.className = 'pill' + (root.Core.isVip() ? ' vip' : '');
    }
  }

  /* ---------------- ranking ---------------- */
  var rankCache = null;
  function renderRanking(rows) {
    var body = $('rankBody');
    if (!body || !root.Core || !root.Core.state) return;
    var data = rows || rankCache || [];
    if (!data.length) {
      var on = root.Cloud && root.Cloud.configured();
      body.innerHTML = '<tr><td colspan="4" class="center muted">' + t(on ? 'rank.empty' : 'rank.offline') + '</td></tr>';
      return;
    }
    var me = root.Core.player.name;
    var html = '';
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      html += '<tr' + (r.name === me ? ' class="you"' : '') + '>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + escapeHtml(r.name) + (r.name === me ? ' · ' + t('rank.you') : '') + (r.vip ? ' ⭐' : '') + '</td>' +
        '<td>' + t('rank.name.' + (r.rankIndex || 0)) + '</td>' +
        '<td class="num">' + fmt(r.balance) + '</td>' +
      '</tr>';
    }
    body.innerHTML = html;
  }

  function refreshRanking() {
    if (!root.Cloud || !root.Cloud.configured()) { renderRanking([]); return Promise.resolve([]); }
    return root.Cloud.leaderboard(25).then(function (r) {
      if (!r.ok) { toast(t('toast.cloudFail') + ' (' + (r.reason || '?') + ')', 'err'); renderRanking([]); return []; }
      rankCache = r.rows;
      renderRanking(r.rows);
      return r.rows;
    });
  }

  /* ---------------- perfil ---------------- */
  function renderProfile() {
    if (!root.Core || !root.Core.state) return;
    ensureCosmetics();
    var box = $('proStats');
    if (box) {
      var s = root.Core.state;
      box.innerHTML =
        '<span class="k">' + t('pro.player') + '</span><span class="v">' + escapeHtml(root.Core.player.name) + '</span>' +
        '<span class="k">' + t('hud.rank') + '</span><span class="v">' + t('rank.name.' + root.Core.rankIndex()) + '</span>' +
        '<span class="k">' + t('hud.style') + '</span><span class="v">' + Math.floor(s.style) + ' (×' + E.prestigeMultiplier(s.style).toFixed(2) + ')</span>' +
        '<span class="k">' + t('ui.total') + ' ' + t('unit.greed') + '</span><span class="v">' + fmt(s.totalEarned) + '</span>' +
        '<span class="k">' + t('pro.referrals') + '</span><span class="v">' + (s.referrals || 0) + '</span>' +
        '<span class="k">' + t('pro.referralCode') + '</span><span class="v mono">' + root.Exchange.ensureReferralCode() + '</span>';
    }
    var ach = $('achList');
    if (ach) {
      var html = '';
      D.achievements.forEach(function (a) {
        var got = !!root.Core.state.achievements[a.id];
        html += '<div class="card" style="grid-column:auto;padding:10px">' +
          '<div class="top"><span class="ico">' + (got ? '🏆' : '🔒') + '</span><span class="nm" style="font-size:.82rem">' + t('ach.title.' + a.id) + '</span></div>' +
          '</div>';
      });
      ach.innerHTML = html;
    }
    var ct = $('cosTitles');
    if (ct) {
      var un = root.Exchange.unlockedCosmetics();
      ct.innerHTML = D.cosmetics.titles.map(function (x) {
        var ok = un.titles.indexOf(x.id) >= 0;
        var active = root.Core.state.prefs.title === x.id;
        return '<button class="btn btn-sm ' + (active ? 'btn-primary' : '') + '" data-title="' + x.id + '"' + (ok ? '' : ' disabled') + '>' +
          (ok ? '' : '🔒 ') + t(x.key) + '</button>';
      }).join(' ');
    }
    var cs = $('cosSkins');
    if (cs) {
      var un2 = root.Exchange.unlockedCosmetics();
      cs.innerHTML = D.cosmetics.skins.map(function (x) {
        var ok = un2.skins.indexOf(x.id) >= 0;
        var active = root.Core.state.prefs.skin === x.id;
        return '<button class="btn btn-sm ' + (active ? 'btn-primary' : '') + '" data-skin="' + x.id + '"' + (ok ? '' : ' disabled') + '>' +
          (ok ? '' : '🔒 ') + t(x.key) + '</button>';
      }).join(' ');
    }
  }

  function ensureCosmetics() {
    root.Exchange.ensureReferralCode();
    applySkin(root.Core.state.prefs.skin);
  }

  function applySkin(skin) {
    ['s_default', 's_sunset', 's_toxic', 's_gold', 's_void'].forEach(function (k) {
      document.body.classList.remove('skin-' + k.replace('s_', ''));
    });
    if (skin && skin !== 's_default') document.body.classList.add('skin-' + skin.replace('s_', ''));
  }

  /* ---------------- eventos temporales ---------------- */
  function activeEvent() {
    var s = root.Core.state;
    if (!s || !s.event) return null;
    if (s.event.endsAt <= Date.now()) return null;
    return s.event;
  }

  function maybeStartEvent() {
    var s = root.Core.state;
    if (activeEvent()) return null;
    var now = Date.now();
    var period = D.eventPeriodMin * 60000;
    if (now - (s.lastEventAt || 0) < period) return null;
    if (Math.random() > 0.35) { s.lastEventAt = now; return null; }
    var totalW = D.events.reduce(function (a, e) { return a + e.weight; }, 0);
    var r = Math.random() * totalW, pick = D.events[0];
    for (var i = 0; i < D.events.length; i++) {
      r -= D.events[i].weight;
      if (r <= 0) { pick = D.events[i]; break; }
    }
    s.event = {
      id: pick.id, key: pick.key, multiplier: pick.multiplier,
      endsAt: now + pick.durationMin * 60000, startedAt: now
    };
    s.lastEventAt = now;
    s.counters.events = (s.counters.events || 0) + 1;
    toast(t('toast.eventStart', { name: t(pick.key) }), '', '⚡');
    sfx.reward();
    return s.event;
  }

  /* ---------------- modal ---------------- */
  function openModal(title, bodyHtml, opts) {
    var back = $('modalBack');
    var box = $('modalBox');
    if (!back || !box) return;
    $('modalTitle').firstChild.nodeValue = title + ' ';
    var body = $('modalBody');
    body.innerHTML = bodyHtml;
    box.classList.toggle('wide', opts && opts.wide !== false);
    back.hidden = false;
    if (opts && opts.onMount) opts.onMount(body);
    return body;
  }

  function closeModal() {
    var back = $('modalBack');
    if (back) back.hidden = true;
  }

  /* ---------------- settings ---------------- */
  function openSettings() {
    var s = root.Core.state;
    var prefs = s.prefs;
    var cloudOn = root.Cloud.configured();
    var conf = root.Cloud.loadConf();
    var html =
      '<div class="settings-grid">' +
        '<div class="card">' +
          '<div class="top"><span class="ico">🎚️</span><span class="nm">' + t('set.title') + '</span></div>' +
          '<div class="setting-row"><span>' + t('set.sound') + '</span><label class="switch"><input type="checkbox" id="setSound"' + (prefs.sound ? ' checked' : '') + '><span></span></label></div>' +
          '<div class="setting-row"><span>' + t('set.particles') + '</span><label class="switch"><input type="checkbox" id="setParticles"' + (prefs.particles ? ' checked' : '') + '><span></span></label></div>' +
          '<div class="setting-row"><span>' + t('set.reducedMotion') + '</span><label class="switch"><input type="checkbox" id="setMotion"' + (prefs.reducedMotion ? ' checked' : '') + '><span></span></label></div>' +
          '<div class="field" style="margin-top:8px"><label>' + t('set.language') + '</label>' +
            '<select class="input" id="setLang">' + root.I18n.LANGS.map(function (l) {
              return '<option value="' + l + '"' + (root.I18n.lang === l ? ' selected' : '') + '>' + l.toUpperCase() + '</option>';
            }).join('') + '</select></div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="top"><span class="ico">👤</span><span class="nm">' + t('set.account') + '</span></div>' +
          '<div class="muted" style="font-size:.82rem">' + escapeHtml(root.Core.player.name) + (root.Core.player.guest ? ' · GUEST' : '') + '</div>' +
          '<button class="btn btn-sm" id="setChangePass">' + t('set.changePass') + '</button>' +
          '<button class="btn btn-sm" id="setLogout">' + t('set.logout') + '</button>' +
          '<button class="btn btn-sm btn-danger" id="setDelete">' + t('set.delete') + '</button>' +
        '</div>' +
        '<div class="card">' +
          '<div class="top"><span class="ico">💾</span><span class="nm">' + t('set.export') + '</span></div>' +
          '<button class="btn btn-sm" id="setExport">' + t('set.export') + '</button>' +
          '<button class="btn btn-sm" id="setImport">' + t('set.import') + '</button>' +
          '<button class="btn btn-sm btn-danger" id="setReset">' + t('set.reset') + '</button>' +
        '</div>' +
        '<div class="card full">' +
          '<div class="top"><span class="ico">☁️</span><span class="nm">' + t('set.cloud') + '</span>' +
            '<span class="tag">' + (cloudOn ? t('cloud.connected') : t('cloud.disconnected')) + '</span></div>' +
          '<div class="setting-row"><span>' + t('set.autoSync') + '</span><label class="switch">' +
            '<input type="checkbox" id="cloudAuto"' + (conf.auto ? ' checked' : '') + '><span></span></label></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button class="btn btn-cyan btn-sm" id="cloudSync">' + t('set.syncNow') + '</button>' +
            '<button class="btn btn-sm" id="cloudRestore">' + t('set.restore') + '</button>' +
            '<button class="btn btn-sm" id="cloudLink">' + t('set.linkDevice') + '</button>' +
            '<button class="btn btn-sm btn-danger" id="cloudClear">' + t('set.clear') + '</button>' +
          '</div>' +
          '<div class="kv" style="margin-top:6px">' +
            '<span class="k">' + t('cloud.yourId') + '</span>' +
            '<span class="v mono" style="font-size:.7rem">' + (s.cloud.playerId || '—') + '</span>' +
            '<span class="k">' + t('set.lastSync') + '</span>' +
            '<span class="v">' + (s.cloud.lastSync ? new Date(s.cloud.lastSync).toLocaleString() : t('set.never')) + '</span>' +
          '</div>' +
          '<div class="notice" style="font-size:.78rem">' + t('cloud.helpNote') + '</div>' +
          '<details style="font-size:.8rem"><summary class="muted">' + t('set.about') + '</summary>' +
            '<div class="muted" style="margin-top:6px">' + t('cloud.help1') + '</div>' +
          '</details>' +
        '</div>' +
      '</div>';
    openModal('⚙️ ' + t('set.title'), html, {
      onMount: function (body) {
        var snd = body.querySelector('#setSound');
        if (snd) snd.onchange = function () { prefs.sound = snd.checked; audio.on = snd.checked; root.Core.save('prefs'); };
        var par = body.querySelector('#setParticles');
        if (par) par.onchange = function () { prefs.particles = par.checked; root.Core.save('prefs'); };
        var mot = body.querySelector('#setMotion');
        if (mot) mot.onchange = function () {
          prefs.reducedMotion = mot.checked;
          document.body.classList.toggle('reduced-motion', mot.checked);
          root.Core.save('prefs');
        };
        var lg = body.querySelector('#setLang');
        if (lg) lg.onchange = function () { root.I18n.set(lg.value); root.I18n.apply(document); renderAll(); };
        body.querySelector('#setLogout').onclick = function () { root.Auth.logout(); };
        body.querySelector('#setDelete').onclick = function () {
          if (!root.confirm(t('set.deleteConfirm'))) return;
          var r = root.Auth.deleteAccount(root.Core.player.name);
          if (r.ok) { toast(t('set.deleted'), 'ok'); setTimeout(function () { root.location.reload(); }, 600); }
          else toast(t('login.' + (r.code || 'errGeneric')), 'err');
        };
        body.querySelector('#setChangePass').onclick = openChangePass;
        body.querySelector('#setExport').onclick = function () {
          openModal('💾 ' + t('set.export'), '<textarea class="input mono" rows="12" readonly>' + escapeHtml(root.Core.exportSave()) + '</textarea>');
        };
        body.querySelector('#setImport').onclick = function () {
          var mb = openModal('📥 ' + t('set.import'), '<textarea class="input mono" id="impBox" rows="10"></textarea>' +
            '<div class="actions"><button class="btn btn-primary" id="impGo">' + t('ui.import') + '</button></div>');
          mb.querySelector('#impGo').onclick = function () {
            var r = root.Core.importSave(mb.querySelector('#impBox').value);
            toast(t(r.ok ? 'toast.imported' : 'toast.importFail'), r.ok ? 'ok' : 'err');
            if (r.ok) { closeModal(); renderAll(); }
          };
        };
        body.querySelector('#setReset').onclick = function () {
          if (!root.confirm(t('set.resetConfirm'))) return;
          root.Core.reset(true);
          toast(t('toast.reset'), 'ok');
          closeModal(); renderAll();
        };
        var auto = body.querySelector('#cloudAuto');
        if (auto) auto.onchange = function () {
          var c2 = root.Cloud.loadConf();
          root.Cloud.saveConf({ url: c2.url, key: c2.key, auto: auto.checked, enabled: c2.enabled });
          if (auto.checked) root.Cloud.start(); else root.Cloud.stop();
        };
        body.querySelector('#cloudLink').onclick = function () {
          var mb = openModal('🔗 ' + t('set.linkDevice'),
            '<div class="notice">' + t('set.linkHelp') + '</div>' +
            '<div class="field"><input class="input mono" id="linkId" placeholder="00000000-0000-0000-0000-000000000000"></div>' +
            '<div class="actions"><button class="btn btn-primary" id="linkGo">' + t('set.linkDevice') + '</button></div>');
          mb.querySelector('#linkGo').onclick = function () {
            var id = mb.querySelector('#linkId').value.trim();
            if (!/^[0-9a-f-]{36}$/i.test(id)) { toast(t('toast.invalidInput'), 'err'); return; }
            root.Cloud.restore(id).then(function (r) {
              toast(t(r.ok ? 'set.linkDone' : 'set.syncFail'), r.ok ? 'ok' : 'err');
              if (r.ok) { closeModal(); renderAll(); }
            });
          };
        };
        body.querySelector('#cloudClear').onclick = function () {
          root.Cloud.clearConf(); root.Cloud.stop();
          toast(t('set.clear'), 'ok');
          renderTopbar();
        };
        body.querySelector('#cloudSync').onclick = function () {
          root.Cloud.sync().then(function (r) {
            toast(t(r.ok ? 'set.syncOk' : 'set.syncFail') + (r.ok ? '' : ' · ' + (r.reason || '')), r.ok ? 'ok' : 'err');
          });
        };
        body.querySelector('#cloudRestore').onclick = function () {
          if (!root.confirm(t('set.restoreConfirm'))) return;
          root.Cloud.restore().then(function (r) {
            toast(t(r.ok ? 'set.syncOk' : 'set.syncFail'), r.ok ? 'ok' : 'err');
            if (r.ok) { closeModal(); renderAll(); }
          });
        };
      }
    });
  }

  function openChangePass() {
    var mb = openModal('🔑 ' + t('set.changePass'),
      '<div class="field"><label>' + t('set.oldPass') + '</label><input class="input" type="password" id="cpOld"></div>' +
      '<div class="field"><label>' + t('set.newPass') + '</label><input class="input" type="password" id="cpNew"></div>' +
      '<div class="actions"><button class="btn btn-primary" id="cpGo">' + t('ui.save') + '</button></div>');
    mb.querySelector('#cpGo').onclick = function () {
      root.Auth.changePassword(root.Core.player.name, mb.querySelector('#cpOld').value, mb.querySelector('#cpNew').value)
        .then(function (r) {
          if (r.ok) { toast(t('set.passChanged'), 'ok'); closeModal(); }
          else toast(t('login.' + (r.code || 'errGeneric')), 'err');
        });
    };
  }

  /* ---------------- prestigio ---------------- */
  function openPrestige() {
    var s = root.Core.state;
    var pts = E.prestigePoints(s.totalEarned);
    var min = D.prestige.minTotalEarned;
    var html =
      '<div class="kv">' +
        '<span class="k">' + t('pre.points') + '</span><span class="v">+' + pts + '</span>' +
        '<span class="k">' + t('pre.total') + '</span><span class="v">' + Math.floor(s.style) + '</span>' +
        '<span class="k">' + t('pre.multiplier') + '</span><span class="v">×' + E.prestigeMultiplier(s.style + pts).toFixed(2) + '</span>' +
        '<span class="k">' + t('ui.total') + '</span><span class="v">' + fmt(s.totalEarned) + '</span>' +
      '</div>' +
      '<div class="notice warn">' + t('pre.warning') + '</div>' +
      (pts
        ? '<button class="btn btn-primary btn-block" id="preGo">♻️ ' + t('pre.button') + '</button>'
        : '<div class="notice danger">' + t('pre.requires', { amount: fmt(min) + ' ' + t('unit.greed') }) + '</div>');
    var mb = openModal('♻️ ' + t('pre.title'), html);
    var go = mb.querySelector('#preGo');
    if (go) go.onclick = function () {
      if (!root.confirm(t('pre.confirm'))) return;
      var r = root.Core.prestige();
      if (r.ok) {
        toast(t('toast.prestigeOk', { points: r.points }), 'ok', '♻️');
        sfx.levelup();
        closeModal(); renderAll();
      }
    };
  }

  /* ---------------- diaria ---------------- */
  function claimDailyUi() {
    var r = root.Core.claimDaily();
    if (!r.ok) {
      if (r.reason === 'already') toast(t('daily.claimed'), 'warn', '🎁');
      else toast(t('daily.needTime'), 'warn', '⌛');
      return;
    }
    toast(t('daily.reward') + ': ' + fmt(r.reward) + ' ' + t('unit.greed') + ' · ' + t('daily.streak') + ' ' + r.streak, 'ok', '🎁');
    sfx.reward();
    renderAll();
  }

  /* ---------------- helpers ---------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

  /* ---------------- eventos DOM ---------------- */
  function bind() {
    // pestañas
    var nav = $('nav');
    if (nav) {
      nav.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-tab]');
        if (!b) return;
        switchTab(b.getAttribute('data-tab'));
      });
    }
    // tap
    var tapZone = $('tapZone');
    function doTap(ev) {
      var s = root.Core.state;
      var gain = root.Core.tap();
      sfx.tap();
      var x = ev && ev.clientX ? ev.clientX : (root.innerWidth / 2);
      var y = ev && ev.clientY ? ev.clientY : (root.innerHeight / 2);
      floater(x, y, '+' + fmt(gain), '#4bff9d');
      if (s.heat >= E.HEAT_MAX * 0.999) { /* la redada ya avisó */ }
      renderHud();
    }
    if (tapZone) {
      tapZone.addEventListener('click', doTap);
      tapZone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doTap(); }
      });
    }
    // delegación en main para todo lo dinámico
    var main = document.querySelector('main');
    if (main) {
      main.addEventListener('click', function (e) {
        var buy = e.target.closest('[data-buy]');
        if (buy) {
          var mode = buy.getAttribute('data-mode');
          var r = root.Core.buyBusiness(buy.getAttribute('data-buy'), mode);
          if (r.ok) { sfx.buy(); toast('+' + r.qty + ' · ' + fmt(r.cost) + ' ' + t('unit.greed'), 'ok', '🛒'); renderAll(); }
          else { sfx.error(); toast(t(r.reason === 'locked' ? 'toast.locked' : 'toast.notEnough'), 'err'); }
          return;
        }
        var upg = e.target.closest('[data-upg]');
        if (upg) {
          var u = root.Core.buyUpgrade(upg.getAttribute('data-upg'));
          if (u.ok) { sfx.upgrade(); toast(t('toast.bought') + ' · ' + t('upg.level') + ' ' + u.level, 'ok', '⬆️'); renderAll(); }
          else { sfx.error(); toast(t(u.reason === 'maxed' ? 'upg.maxed' : 'toast.notEnough'), 'err'); }
          return;
        }
        var mis = e.target.closest('[data-mission]');
        if (mis) {
          var m = root.Core.claimMission(mis.getAttribute('data-mission'));
          if (m.ok) { sfx.reward(); toast(t('toast.missionDone') + ' +' + fmt(m.reward), 'ok', '🎯'); renderAll(); }
          else { sfx.error(); toast(t('toast.locked'), 'err'); }
          return;
        }
        var vip = e.target.closest('[data-vip]');
        if (vip) { buyVipUi(Number(vip.getAttribute('data-vip'))); return; }
        var ttl = e.target.closest('[data-title]');
        if (ttl) { root.Core.state.prefs.title = ttl.getAttribute('data-title'); root.Core.save('prefs'); renderProfile(); return; }
        var skin = e.target.closest('[data-skin]');
        if (skin) {
          root.Core.state.prefs.skin = skin.getAttribute('data-skin');
          applySkin(skin.getAttribute('data-skin'));
          root.Core.save('prefs'); renderProfile(); return;
        }
      });
    }
    // botones de cabecera
    var bs = $('btnSettings'); if (bs) bs.onclick = openSettings;
    var bd = $('btnDaily'); if (bd) bd.onclick = claimDailyUi;
    var bp = $('btnPrestige'); if (bp) bp.onclick = openPrestige;
    var brr = $('btnRankRefresh'); if (brr) brr.onclick = refreshRanking;
    var mclose = $('modalClose'); if (mclose) mclose.onclick = closeModal;
    var mback = $('modalBack');
    if (mback) mback.addEventListener('click', function (e) { if (e.target === mback) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
      if (e.key === ' ' && e.target === document.body) { e.preventDefault(); }
    });

    // exchange
    var amt = $('swAmount');
    if (amt) amt.addEventListener('input', function () { renderExchange(); renderWithdraw(); });
    var wdm = $('wdMethod');
    if (wdm) wdm.addEventListener('change', function () {
      if (root.Core && root.Core.state) { root.Core.state.prefs.wdMethod = wdm.value; root.Core.save('prefs'); }
      renderWithdraw();
    });
    var wdg = $('wdGo');
    if (wdg) wdg.onclick = function () {
      var g = root.Exchange.gate();
      if (!g.open) { sfx.error(); toast(t('wd.gateRequired', { rank: t(g.minRankKey) }), 'err'); return; }
      var raw = ($('swAmount') && $('swAmount').value) || '';
      var greed = Number(String(raw).replace(/[^0-9]/g, ''));
      if (!greed) { toast(t('toast.invalidInput'), 'warn'); if ($('swAmount')) $('swAmount').focus(); return; }
      var method = $('wdMethod') ? $('wdMethod').value : 'wallet';
      if (method === 'cloud' && !root.Cloud.configured()) { toast(t('wd.cloudHelp'), 'err'); return; }
      var wallet = null;
      if (root.Chain && root.Chain.state) wallet = root.Chain.state.account || null;
      if (!root.Cloud.configured()) {
        // sin backend: solicitud local (el voucher lo pega el operador)
        var r0 = root.Exchange.request(String(greed));
        if (r0.ok) { toast(t('sw.request') + ' · ' + fmtUsdt(r0.entry.usdt) + ' USDT', 'ok', '🔁'); switchTab('exchange'); }
        else { sfx.error(); toast(t('toast.invalidInput') + ' (' + r0.reason + ')', 'err'); }
        return;
      }
      wdg.disabled = true;
      // el servidor valida rango y cupos con SU copia del jugador: primero sync
      root.Cloud.sync().catch(function () { return null; }).then(function () {
        return root.Cloud.requestWithdraw(greed, wallet);
      }).then(function (r) {
        wdg.disabled = false;
        if (!r.ok) {
          sfx.error();
          var msg = { need_rank: t('wd.gateRequired', { rank: t('rank.name.' + D.swap.minRankIndex) }),
                      below_min: t('sw.belowMin', { min: D.swap.minUsdt }),
                      player_cap: t('sw.overCap', { cap: D.swap.playerDailyCapUsdt }),
                      global_cap: t('sw.globalEmpty'), not_found: t('wd.notConnected') }[r.error || r.reason];
          toast(msg || t('toast.cloudFail') + ' (' + (r.error || r.reason) + ')', 'err');
          return;
        }
        // el backend ya autorizó: creamos la solicitud local y aplicamos el voucher
        var req = root.Exchange.request(String(greed));
        if (!req.ok) { toast(t('toast.invalidInput') + ' (' + req.reason + ')', 'err'); return; }
        if (extraCheckFailed(req)) return;
        var applied = root.Exchange.applyVoucher(r.voucher);
        if (applied.ok) {
          toast(t('sw.status.signed') + (r.voucher.unsigned ? ' · demo' : ''), 'ok', '✍️');
          sfx.reward();
          switchTab('exchange');
        } else {
          root.Exchange.reject('voucher');
          toast(t('sw.invalidVoucher') + ' (' + applied.reason + ')', 'err');
        }
      });
    };
    var swr = $('swRequest');
    if (swr) swr.onclick = function () {
      var val = String(amt.value || '').replace(/[^0-9]/g, '');
      var r = root.Exchange.request(val);
      if (r.ok) {
        sfx.reward();
        toast(t('sw.request') + ' · ' + fmtUsdt(r.entry.usdt) + ' USDT', 'ok', '🔁');
        renderAll();
      } else {
        sfx.error();
        var msg = { needRank: t('sw.needRank', { rank: t('rank.name.' + D.swap.minRankIndex) }),
                    below_min: t('sw.belowMin', { min: D.swap.minUsdt }),
                    player_cap: t('sw.overCap', { cap: D.swap.playerDailyCapUsdt }),
                    cash: t('toast.notEnough'), pending: t('sw.pending') }[r.reason] || t('toast.invalidInput');
        toast(msg, 'err');
      }
    };
    var swa = $('swApply');
    if (swa) swa.onclick = function () {
      var r = root.Exchange.applyVoucher($('swVoucher').value);
      if (r.ok) { toast(t('sw.status.signed'), 'ok', '✍️'); renderAll(); }
      else { sfx.error(); toast(t('sw.invalidVoucher') + ' (' + r.reason + ')', 'err'); }
    };
    var swrj = $('swReject');
    if (swrj) swrj.onclick = function () {
      var r = root.Exchange.reject('manual');
      if (r.ok) { toast(t('sw.rejected') + ' +' + fmt(r.refunded), 'warn', '↩️'); renderAll(); }
    };
    var swc = $('swClaim');
    if (swc) swc.onclick = function () {
      var sum = root.Exchange.summary();
      if (!sum.pending || !sum.pending.voucher) { toast(t('sw.invalidVoucher'), 'err'); return; }
      if (!root.Chain.hasWallet()) { toast(t('toast.walletNeeded'), 'err'); return; }
      toast(t('sw.awaitingChain'), 'warn', '⏳');
      root.Chain.claimSwap(sum.pending.voucher).then(function (r) {
        if (r.ok) {
          root.Exchange.markClaimed(r.hash);
          toast(t('sw.claimed') + (r.hash ? ' · ' + r.hash.slice(0, 12) + '…' : ''), 'ok', '✅');
          renderAll();
        } else {
          // si la cadena no está disponible no rompemos la partida
          toast(t('toast.txFail') + ' (' + (r.reason || r.error || '?') + ')', 'err');
        }
      });
    };
  }

  /** Guarda de coherencia: nunca dejar un pending sin voucher válido. */
  function extraCheckFailed(req) {
    if (req.ok) return false;
    return true;
  }

  function buyVipUi(index) {
    var plan = D.vip.plans[index];
    if (!plan) return;
    if (!root.Chain.hasWallet()) {
      // sin cartera: modo demo local para que el pase se pueda probar
      var mb = openModal('⭐ ' + t('vip.title'),
        '<div class="notice warn">' + t('vip.needWallet') + '</div>' +
        '<div class="notice">' + t('vip.split') + '</div>',
        { wide: false });
      void mb;
      return;
    }
    toast(t('vip.buying'), 'warn', '⏳');
    root.Chain.buyVip(index).then(function (r) {
      if (r.ok) { grantVip(plan); toast(t('vip.bought'), 'ok', '⭐'); }
      else toast(t('vip.failed') + ' (' + (r.reason || '') + ')', 'err');
    });
  }

  /** Activa el VIP (lo llama chain tras el evento on-chain o el modo demo). */
  function grantVip(plan) {
    var s = root.Core.state;
    var base = Math.max(Date.now(), s.vipUntil || 0);
    s.vipUntil = base + plan.days * 86400000;
    s.counters.vipBought = (s.counters.vipBought || 0) + 1;
    root.Core.checkAchievements();
    root.Core.save('vip');
    renderAll();
  }

  /* ---------------- pestañas ---------------- */
  function switchTab(tab) {
    currentTab = tab;
    root.Core.state.prefs.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('#nav button[data-tab]'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) {
      p.classList.toggle('active', p.id === 'tab-' + tab);
    });
    renderTab(tab, true);
    if (tab === 'ranking') refreshRanking();
  }

  /* ---------------- arranque de la UI ---------------- */
  function mount() {
    bind();
    initCity();
    document.body.classList.toggle('reduced-motion', !!root.Core.state.prefs.reducedMotion);
    applySkin(root.Core.state.prefs.skin);
    if (root.Core.state.prefs.wdMethod && $('wdMethod')) $('wdMethod').value = root.Core.state.prefs.wdMethod;
    var tab = root.Core.state.prefs.tab || 'empire';
    switchTab(tab);
    renderAll();
    var off = root.Core.takeOfflineReport();
    if (off && off.gained > 0) {
      toast(t('toast.offlineGain') + ': ' + fmt(off.gained) + ' ' + t('unit.greed') +
        ' (' + timeLeft(off.seconds * 1000) + ')', 'ok', '🌙');
    }
    // bucle de render
    root.setInterval(function () {
      renderHud();
      if (currentTab !== 'ranking') renderTab(currentTab, false);
    }, 400);
    root.setInterval(function () {
      renderTab(currentTab, true);
    }, 1200);
    root.setInterval(maybeStartEvent, 20000);
    // autoguardado
    root.setInterval(function () { root.Core.save('auto'); }, 10000);
    root.addEventListener('beforeunload', function () { root.Core.save('unload'); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) root.Core.save('hidden');
    });
    // reacciones a eventos del core
    root.Core.on('raid', function (loss) {
      toast(t('toast.raid') + ' (−' + fmt(loss) + ')', 'err', '🚨');
      sfx.raid();
    });
    root.Core.on('change', function (what) {
      if (what === 'mission' || what === 'buy' || what === 'upgrade' || what === 'offline') {
        var got = root.Core.checkAchievements();
        if (got.length) { toast(t('toast.achUnlocked') + ': ' + t('ach.title.' + got[0]), 'ok', '🏆'); sfx.reward(); }
      }
    });
    var lastRank = root.Core.rankIndex();
    root.Core.on('tick', function () {
      var r = root.Core.rankIndex();
      if (r > lastRank) {
        lastRank = r;
        toast(t('toast.rankUp', { rank: t('rank.name.' + r) }), 'ok', '⬆️');
        sfx.levelup();
        renderTab(currentTab, true);
      }
    });
  }

  var UI = {
    fmt: fmt,
    fmtUsdt: fmtUsdt,
    fmtGreed: fmtGreed,
    timeLeft: timeLeft,
    toast: toast,
    floater: floater,
    sfx: sfx,
    audio: audio,
    renderAll: renderAll,
    renderHud: renderHud,
    renderTab: renderTab,
    renderBiz: renderBiz,
    renderUpgrades: renderUpgrades,
    renderMissions: renderMissions,
    renderExchange: renderExchange,
    renderWithdraw: renderWithdraw,
    renderVip: renderVip,
    renderProfile: renderProfile,
    renderRanking: renderRanking,
    refreshRanking: refreshRanking,
    switchTab: switchTab,
    openModal: openModal,
    closeModal: closeModal,
    openSettings: openSettings,
    openPrestige: openPrestige,
    claimDailyUi: claimDailyUi,
    grantVip: grantVip,
    applySkin: applySkin,
    mount: mount,
    activeEvent: activeEvent,
    maybeStartEvent: maybeStartEvent,
    bind: bind,
    escapeHtml: escapeHtml,
    get currentTab() { return currentTab; },
    onLangChange: function () { renderAll(); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = UI;
  root.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
