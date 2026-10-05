// Motor determinístico: cada frame é uma função pura do tempo t (em segundos).
// Nada depende de relógio real, então o render quadro a quadro sai idêntico sempre.
(function () {
  const P = new URLSearchParams(location.search);
  const FMT = P.get('fmt') === 'h' ? 'h' : 'v';
  const V = FMT === 'v';
  const W = V ? 1080 : 1920;
  const H = V ? 1920 : 1080;
  const DUR = 43;

  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const inv = (a, b, x) => clamp((x - a) / (b - a));
  const PI = Math.PI;

  const ease = {
    lin: t => t,
    in2: t => t * t,
    out2: t => 1 - (1 - t) * (1 - t),
    io2: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    in3: t => t * t * t,
    out3: t => 1 - Math.pow(1 - t, 3),
    io3: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    in4: t => t * t * t * t,
    out4: t => 1 - Math.pow(1 - t, 4),
    io4: t => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
    out5: t => 1 - Math.pow(1 - t, 5),
    io5: t => (t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2),
    inExpo: t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    outExpo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    ioExpo: t => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
    outCirc: t => Math.sqrt(1 - Math.pow(t - 1, 2)),
    inCirc: t => 1 - Math.sqrt(1 - t * t),
    outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outBackS: t => { const c1 = 2.6, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    inBack: t => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; },
    outElastic: t => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * PI) / 3)) + 1),
  };
  const E = e => (typeof e === 'function' ? e : ease[e] || ease.io3);

  // Mola física em segundos: 0 → 1 com overshoot. f = frequência (Hz), z = amortecimento.
  function spr(dt, f = 2.2, z = 0.5) {
    if (dt <= 0) return 0;
    const w = 2 * PI * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * dt) * (Math.cos(wd * dt) + ((z * w) / wd) * Math.sin(wd * dt));
  }

  const mixv = (a, b, p) => (Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], p)) : lerp(a, b, p));

  // Tween simples entre dois tempos
  function tw(t, t0, t1, a, b, e = 'io3') {
    if (t <= t0) return a;
    if (t >= t1) return b;
    return mixv(a, b, E(e)((t - t0) / (t1 - t0)));
  }
  // Keyframes: k(t, [t0,v0], [t1,v1,ease], ...)
  function k(t, ...keys) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, e] = keys[i];
      if (t < t1) {
        const [t0, v0] = keys[i - 1];
        return mixv(v0, v1, E(e)((t - t0) / (t1 - t0)));
      }
    }
    return keys[keys.length - 1][1];
  }

  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Ruído suave (soma de senos incomensuráveis), em -1..1
  const wob = (t, s = 0) => Math.sin(t * 1.73 + s) * 0.5 + Math.sin(t * 2.91 + s * 1.31) * 0.3 + Math.sin(t * 5.27 + s * 2.17) * 0.2;
  // Tremida de câmera com envelope decrescente
  function shake(t, t0, dur, amp, freq = 22) {
    if (t < t0 || t > t0 + dur) return { x: 0, y: 0, r: 0 };
    const env = Math.pow(1 - (t - t0) / dur, 2) * amp;
    const u = (t - t0) * freq;
    return { x: wob(u, 1.1) * env, y: wob(u, 7.3) * env, r: wob(u, 3.7) * env * 0.04 };
  }

  function T(o) {
    let s = '';
    if (o.p) s += `perspective(${o.p}px) `;
    s += `translate3d(${(o.x || 0).toFixed(2)}px,${(o.y || 0).toFixed(2)}px,${(o.z || 0).toFixed(2)}px)`;
    if (o.rx) s += ` rotateX(${o.rx.toFixed(3)}deg)`;
    if (o.ry) s += ` rotateY(${o.ry.toFixed(3)}deg)`;
    if (o.r) s += ` rotate(${o.r.toFixed(3)}deg)`;
    if (o.skx) s += ` skewX(${o.skx.toFixed(3)}deg)`;
    const sc = o.s === undefined ? 1 : o.s;
    const sx = sc * (o.sx === undefined ? 1 : o.sx), sy = sc * (o.sy === undefined ? 1 : o.sy);
    if (sx !== 1 || sy !== 1) s += ` scale(${sx.toFixed(4)},${sy.toFixed(4)})`;
    return s;
  }
  const TKEYS = ['x', 'y', 'z', 's', 'sx', 'sy', 'r', 'rx', 'ry', 'skx', 'p'];
  function set(el, o) {
    if (!el) return;
    const st = el.style;
    if (TKEYS.some(key => key in o)) st.transform = T(o);
    if ('o' in o) st.opacity = clamp(o.o).toFixed(3);
    if ('blur' in o) st.filter = o.blur > 0.05 ? `blur(${o.blur.toFixed(2)}px)` : 'none';
    if ('filter' in o) st.filter = o.filter;
    if ('vis' in o) st.visibility = o.vis ? 'visible' : 'hidden';
    if ('w' in o) st.width = o.w + 'px';
    if ('h' in o) st.height = o.h + 'px';
    if ('bg' in o) st.background = o.bg;
    if ('clip' in o) st.clipPath = o.clip;
    if ('txt' in o && el.__txt !== o.txt) { el.textContent = o.txt; el.__txt = o.txt; }
    if ('html' in o && el.__html !== o.html) { el.innerHTML = o.html; el.__html = o.html; }
  }

  function h(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }
  function add(parent, html) {
    const e = h(html);
    parent.appendChild(e);
    return e;
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function brl(n, cents = true) {
    const neg = n < 0; n = Math.abs(n);
    const fixed = cents ? n.toFixed(2) : Math.round(n).toString();
    let [i, d] = fixed.split('.');
    i = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + 'R$ ' + i + (cents ? ',' + d : '');
  }
  const intBR = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Cenas
  const scenes = [];
  const globals = [];
  function scene(def) { scenes.push(def); return def; }
  function global(def) { globals.push(def); return def; }

  // Deixas de som: as cenas registram aqui e o render exporta para a trilha
  const cues = [];
  function cue(t, name, opts = {}) { cues.push(Object.assign({ t: +t.toFixed(4), name }, opts)); }

  function seek(t) {
    for (const s of scenes) {
      const vis = t >= s.start && t < s.end;
      if (vis !== s._vis) { s.root.style.display = vis ? '' : 'none'; s._vis = vis; }
      if (vis) s.update(t);
    }
    for (const g of globals) g.update(t);
  }

  // Títulos que não cabem na largura da zona encolhem até caber
  function fitHeadlines(root) {
    root.querySelectorAll('.hl').forEach(el => {
      const avail = el.clientWidth;
      let widest = 0;
      el.querySelectorAll('.ln').forEach(ln => { ln.style.display = 'inline-block'; widest = Math.max(widest, ln.getBoundingClientRect().width); ln.style.display = ''; });
      if (widest > avail && avail > 0) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = (fs * avail / widest * 0.97).toFixed(1) + 'px';
      }
    });
  }

  async function init() {
    document.body.classList.add('fmt-' + FMT);
    const frame = $('#frame');
    frame.style.width = W + 'px';
    frame.style.height = H + 'px';
    const layer = $('#scenes');
    for (const s of scenes) {
      s.root = add(layer, `<div class="scene" id="${s.id}" style="z-index:${s.z || 0}"></div>`);
      s.build(s.root);
      s.root.style.display = 'none';
      s._vis = false;
    }
    for (const g of globals) g.build && g.build();
    const faces = ['300 40px Figtree', '500 40px Figtree', '700 40px Figtree', '800 40px Figtree', '900 40px Figtree',
      '300 40px Raleway', '600 40px Raleway', '700 40px Raleway', '500 20px "JetBrains Mono"', '700 20px "JetBrains Mono"',
      '400 20px "PT Sans"', '700 20px "PT Sans"', '600 40px Caveat'];
    await Promise.all(faces.map(f => document.fonts.load(f, 'AaÇãé0123')));
    await document.fonts.ready;
    await Promise.all($$('img').map(img => (img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; }))).concat($$('img').map(img => img.decode().catch(() => {}))));
    // medidas precisam da cena visível
    for (const s of scenes) { s.root.style.display = ''; fitHeadlines(s.root); s.ready && s.ready(); s.root.style.display = 'none'; s._vis = false; }
    seek(0);
    window.__ready = true;
  }

  window.SR = { FMT, V, W, H, DUR, clamp, lerp, inv, ease, E, spr, tw, k, rng, wob, shake, T, set, h, add, $, $$, esc, brl, intBR, scene, global, cue, cues, seek, init, PI };
  window.__seek = t => { seek(t); };
  window.__cues = cues;
})();
