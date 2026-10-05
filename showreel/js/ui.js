// Peças reutilizáveis: título cinético, palco da interface, componentes Kommo, participações 3D.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, esc } = SR;

  // Zonas de layout por formato
  const Z = V
    ? { hl: { top: 236, left: 70, width: 940, size: 126 }, stage: { cx: 540, cy: 1108, w: 960, h: 920, s: 1 } }
    : { hl: { top: 300, left: 112, width: 760, size: 112 }, stage: { cx: 1388, cy: 548, w: 960, h: 920, s: 1 } };
  SR.Z = Z;

  // Palco: caixa de 960x920 onde a interface vive, posicionada na zona certa de cada formato
  SR.Stage = function (root, cls = '') {
    const st = add(root, `<div class="stage ${cls}" style="position:absolute;width:${Z.stage.w}px;height:${Z.stage.h}px;left:${Z.stage.cx - Z.stage.w / 2}px;top:${Z.stage.cy - Z.stage.h / 2}px;transform-origin:50% 50%"></div>`);
    return st;
  };

  // Título cinético. lines: [['O','funil','anda'], [{t:'sozinho.', c:'em'}]]
  SR.Headline = function (root, lines, opt = {}) {
    const z = Object.assign({}, Z.hl, opt);
    const el = add(root, `<div class="hl" style="top:${z.top}px;${V ? '' : `left:${z.left}px;width:${z.width}px;`}font-size:${z.size}px"></div>`);
    const words = [];
    lines.forEach(line => {
      const ln = add(el, `<span class="ln"></span>`);
      line.forEach((w, i) => {
        const o = typeof w === 'string' ? { t: w } : w;
        const span = add(ln, `<span class="w ${o.c || ''}">${esc(o.t)}</span>`);
        words.push(span);
        if (i < line.length - 1) ln.appendChild(document.createTextNode(' '));
      });
    });
    return {
      el, words,
      // tin: início da entrada, tout: início da saída
      update(t, tin, tout, o = {}) {
        const st = o.stagger || 0.055, dIn = o.dIn || 0.62, dOut = o.dOut || 0.34;
        words.forEach((w, i) => {
          const a = tin + i * st;
          const pin = clamp((t - a) / dIn);
          const ein = E('outExpo')(pin);
          const b = tout + i * 0.028;
          const pout = clamp((t - b) / dOut);
          const eout = E('in3')(pout);
          const y = (1 - ein) * 112 - eout * 112;
          set(w, { y: y * (z.size / 100), r: (1 - ein) * 6 - eout * 3, o: Math.min(1, pin * 3) * (1 - pout * 0.6) });
        });
        set(el, { o: t < tin - 0.05 || t > tout + dOut + words.length * 0.028 + 0.05 ? 0 : 1 });
      },
    };
  };

  SR.spark = (size = 56, extra = '') => `<span class="spark" style="width:${size}px;height:${size}px;${extra}">${ICONS.spark.replace('fill="currentColor"', 'fill="#fff"')}</span>`;

  SR.kcard = (d, extra = '') => `
    <div class="kcard ${d.cls || ''}" style="${extra}">
      <div class="r1"><div class="av" style="background:${d.avbg || 'linear-gradient(135deg,#FFB38A,#EF4F24)'}">${d.ini || ''}</div>
        <div style="min-width:0"><div class="nm"><b>${d.nome}</b>${d.sub ? ', ' + d.sub : ''}</div><div class="co">${d.empresa}</div></div></div>
      <div class="mt">${d.data || '05.10.2026'} ${(d.tags || []).map(tg => `<span class="tag ${tg[1] || ''}">${tg[0]}</span>`).join('')}<span style="flex:1"></span><span class="dot" style="background:${d.dot || '#F5A623'}"></span></div>
      ${d.extra || ''}
    </div>`;

  SR.pill = (txt, extra = '') => `<div class="pill" style="${extra}">${SR.spark(46)}<span>${txt}</span></div>`;

  SR.char = (name, w, extra = '') => `<img class="abs char" src="assets/kommo/${name}.png" style="width:${w}px;${extra};filter:drop-shadow(0 26px 28px rgba(0,0,0,.45))">`;

  // Participação de personagem 3D: entra com mola, flutua, sai encolhendo
  SR.cameo = function (el, t, tin, tout, o = {}) {
    if (t < tin - 0.01 || t > tout + 0.45) { set(el, { o: 0, s: 0 }); return; }
    const pin = spr(t - tin, o.f || 2.4, o.z || 0.42);
    const pout = clamp((t - tout) / 0.4);
    const eo = E('inBack')(pout);
    const bob = Math.sin((t - tin) * 4.2) * (o.bob ?? 10);
    const rot = (o.r || 0) + Math.sin((t - tin) * 3.1) * (o.wig ?? 5) + (1 - Math.min(1, pin)) * (o.rin ?? -25);
    set(el, { x: (o.x || 0) + (o.dx || 0) * (1 - pin), y: (o.y || 0) + bob + (o.dy || 0) * (1 - pin), s: Math.max(0, pin * (1 - eo)) * (o.s || 1), r: rot, o: 1 });
  };

  // Digitação
  SR.typeOn = function (el, text, p, caret = false) {
    const n = Math.round(text.length * clamp(p));
    const s = text.slice(0, n) + (caret && p > 0 && p < 1 ? '▍' : '');
    if (el.__t !== s) { el.textContent = s; el.__t = s; }
  };

  // Rastro de eco para objetos voando: fn(t) → {x,y,s,r,o}
  SR.Echo = function (parent, html, n = 5) {
    const ghosts = [];
    for (let i = n; i >= 1; i--) ghosts.push(add(parent, html));
    const main = add(parent, html);
    return {
      main, ghosts,
      update(t, fn, dt = 0.022, fade = 0.5) {
        const m = fn(t);
        set(main, m);
        ghosts.forEach((g, j) => {
          const i = n - j;
          const q = fn(t - i * dt);
          const speed = Math.hypot(m.x - q.x, m.y - q.y);
          set(g, Object.assign({}, q, { o: (q.o ?? 1) * (speed > 4 ? fade * (1 - i / (n + 1)) : 0) }));
        });
      },
    };
  };

  // Curva de Bézier quadrática para trajetórias de voo
  SR.bez = (p0, p1, p2, u) => [
    (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0],
    (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1],
  ];
})();
