// Cena 13 · Assinatura (37–43s): símbolo CG nasce dos dois anéis, marca, "Do oi ao pago.", selo Kommo partner
// e CTA para o Instagram @control.gestao.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, cue, rng } = SR;
  const L = SR.LOGO, sc = L.w / 1330, LH = 708 * sc;
  const HIT = 37.0;
  const R = rng(2024);
  const dust = Array.from({ length: 26 }, () => ({ x: R() * W, y: R() * H, s: 2 + R() * 4, v: 14 + R() * 30, ph: R() * 6 }));
  const Y = V
    ? { word: L.cy + LH / 2 + 52, tag: L.cy + LH / 2 + 190, sub: L.cy + LH / 2 + 345, row: L.cy + LH / 2 + 450, fs: { word: 74, tag: 128, sub: 44 } }
    : { word: L.cy + LH / 2 + 34, tag: L.cy + LH / 2 + 118, sub: L.cy + LH / 2 + 240, row: L.cy + LH / 2 + 316, fs: { word: 54, tag: 104, sub: 36 } };

  SR.scene({
    id: 's13', start: 36.96, end: 43.05,
    build(root) {
      const P = window.CG_PATHS;
      this.dust = dust.map(d => add(root, `<div class="abs" style="left:${d.x}px;top:${d.y}px;width:${d.s}px;height:${d.s}px;border-radius:50%;background:rgba(255,255,255,.6);opacity:0"></div>`));
      this.glow = add(root, `<div class="abs" style="left:${L.cx - 520}px;top:${L.cy - 520}px;width:1040px;height:1040px;border-radius:50%;background:radial-gradient(closest-side, rgba(239,79,36,.45), rgba(123,92,255,.18) 55%, transparent 72%);opacity:0"></div>`);
      this.sym = add(root, `<svg class="abs" viewBox="0 0 1330 708" style="left:${L.cx - L.w / 2}px;top:${L.cy - LH / 2}px;width:${L.w}px;height:${LH}px;overflow:visible;transform-origin:50% 50%">
        <defs><linearGradient id="lensG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF7A45"/><stop offset="1" stop-color="#EF4F24"/></linearGradient>
        <filter id="lensGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <g class="cg"><path class="pc" fill="#fff" fill-rule="evenodd" d="${P.C}"/><path class="pg1" fill="#fff" fill-rule="evenodd" d="${P.Gtop}"/><path class="pg2" fill="#fff" fill-rule="evenodd" d="${P.Gbot}"/></g>
        <g class="lens" style="transform-origin:654px 354px" filter="url(#lensGlow)"><path fill="url(#lensG)" fill-rule="evenodd" d="${P.lens}"/></g></svg>`);
      this.cg = this.sym.querySelector('.cg'); this.lens = this.sym.querySelector('.lens');
      this.word = add(root, `<div class="abs" style="left:0;right:0;top:${Y.word}px;text-align:center;font:300 ${Y.fs.word}px/1 Raleway;color:#fff;white-space:nowrap"><span class="c1">CONTROL</span> <span class="c2" style="font-weight:700;color:#EF4F24">GESTÃO</span></div>`);
      this.tag = add(root, `<div class="abs" style="left:0;right:0;top:${Y.tag}px;text-align:center;font:900 ${Y.fs.tag}px/1 var(--fig);letter-spacing:-.045em;color:#fff;white-space:nowrap">
        <span class="ln" style="display:inline-block;overflow:hidden;padding:.06em .08em .16em;margin:-.06em -.08em -.16em"><span class="w" style="display:inline-block">Do</span> <span class="w" style="display:inline-block">oi</span> <span class="w" style="display:inline-block">ao</span> <span class="w" style="display:inline-block;background:linear-gradient(95deg,#FF9A5A,#EF4F24 48%,#FF3D60);-webkit-background-clip:text;background-clip:text;color:transparent">pago.</span></span></div>`);
      this.tws = [...this.tag.querySelectorAll('.w')];
      this.swoosh = add(root, `<svg class="abs" viewBox="0 0 400 40" style="left:0;top:0;width:400px;height:40px;overflow:visible"><path d="M6 26 C 120 6, 260 6, 394 20" fill="none" stroke="#EF4F24" stroke-width="9" stroke-linecap="round" stroke-dasharray="420" stroke-dashoffset="420"/></svg>`);
      this.swp = this.swoosh.querySelector('path');
      this.sub = add(root, `<div class="abs" style="left:0;right:0;top:${Y.sub}px;text-align:center;font:600 ${Y.fs.sub}px var(--fig);color:#C9C3F0;white-space:nowrap">IA no Kommo, de ponta a ponta.</div>`);
      const bw = V ? 300 : 250;
      this.row = add(root, `<div class="abs" style="left:0;right:0;top:${Y.row}px;display:flex;justify-content:center;align-items:center;gap:${V ? 26 : 22}px">
        <div class="badge" style="position:relative;display:flex;flex-direction:column;align-items:center;gap:8px"><div style="font:700 ${V ? 16 : 14}px var(--mono);letter-spacing:.18em;color:#9FE6FF">PARCEIRO EXPERT</div>
          <div style="background:#fff;border-radius:20px;padding:${V ? 14 : 11}px ${V ? 20 : 16}px;box-shadow:0 18px 40px rgba(0,0,0,.4)"><img src="assets/img/kommo-partner.png" style="display:block;width:${bw}px"></div></div>
        <div class="cta" style="position:relative;display:flex;flex-direction:column;align-items:center;gap:8px"><div style="font:700 ${V ? 16 : 14}px var(--mono);letter-spacing:.18em;color:#9FE6FF">CHAMA NO DIRECT</div>
          <div class="pillc" style="position:relative;display:flex;align-items:center;gap:16px;padding:${V ? '16px 30px 16px 16px' : '13px 26px 13px 13px'};border-radius:999px;background:linear-gradient(95deg,#E6F76A,#6FF0D2);color:#0E0142;font:900 ${V ? 44 : 36}px var(--fig);box-shadow:0 18px 44px rgba(111,240,210,.35);overflow:hidden">
            <img src="assets/kommo/ch-instagram.png" style="width:${V ? 74 : 60}px;height:${V ? 74 : 60}px;border-radius:20px">@control.gestao<span class="tap abs" style="left:0;top:0;width:90px;height:90px;margin:-45px;border-radius:50%;background:rgba(255,255,255,.75);opacity:0"></span></div></div></div>`);
      this.badge = this.row.querySelector('.badge'); this.cta = this.row.querySelector('.cta'); this.pillc = this.row.querySelector('.pillc'); this.tap = this.row.querySelector('.tap');
      this.sweep = add(root, `<div class="abs" style="left:${-W}px;top:0;width:${W * 0.5}px;height:${H}px;background:linear-gradient(100deg, transparent 0%, rgba(255,255,255,.0) 30%, rgba(255,255,255,.16) 50%, rgba(255,255,255,0) 70%, transparent 100%);mix-blend-mode:screen;opacity:0"></div>`);
      SR.flashAt(HIT, 0.4, '#ffffff', 0.9);
      SR.leakAt(HIT - 0.05, 1.6, ['#EF4F24', '#7B5CFF'], 0.7);
      SR.shakeAt(HIT, 0.5, 16);
      cue(HIT, 'impactBig', { gain: 1 });
      cue(37.6, 'tracking', { gain: 0.6 });
      cue(38.4, 'hitSoft', { gain: 0.8 }); cue(38.62, 'hitSoft', { gain: 0.7, pitch: 2 });
      cue(39.05, 'swoosh', { gain: 0.6 });
      cue(39.7, 'popIn', { gain: 0.6 }); cue(39.9, 'popOut', { gain: 0.7 });
      cue(40.6, 'tap', { gain: 0.9 });
      cue(41.1, 'shimmer', { gain: 0.45 });
    },
    update(t) {
      const a = t - HIT;
      // símbolo: os anéis viram C e G, a lente acende
      const settle = a < 0 ? 0 : 1 + Math.exp(-a * 5) * Math.sin(a * 14) * 0.035;
      const breathe = 1 + Math.sin(t * 1.4) * 0.006;
      set(this.sym, { s: (a < 0 ? 1 : settle) * breathe, y: Math.sin(t * 1.1) * 4, o: a < 0 ? 0 : 1 });
      const lp = spr(a - 0.05, 2.2, 0.42);
      this.lens.style.transform = `scale(${Math.max(0, lp).toFixed(4)})`;
      set(this.glow, { o: a < 0 ? 0 : k(t, [HIT, 1], [HIT + 0.8, 0.55, 'out2'], [41.0, 0.55], [41.5, 0.8], [42.2, 0.6]), s: 1 + Math.sin(t * 1.3) * 0.03 });
      // marca
      const wp = E('out4')(clamp((t - 37.55) / 0.8));
      this.word.style.letterSpacing = `${(0.75 - 0.63 * wp).toFixed(3)}em`;
      set(this.word, { o: wp, blur: (1 - wp) * 8 });
      // frase
      this.tws.forEach((w, i) => {
        const p = E('outExpo')(clamp((t - 38.35 - i * 0.09) / 0.6));
        set(w, { y: (1 - p) * Y.fs.tag * 1.15, r: (1 - p) * 6 });
      });
      set(this.tag, { o: t >= 38.3 ? 1 : 0 });
      // sublinhado sob "pago."
      const last = this.tws[3].getBoundingClientRect();
      const swp = E('io3')(clamp((t - 39.02) / 0.4));
      this.swoosh.style.width = last.width + 'px';
      set(this.swoosh, { x: last.left, y: last.bottom - 6, o: t >= 39.0 ? 1 : 0 });
      this.swp.setAttribute('stroke-dashoffset', (420 * (1 - swp)).toFixed(1));
      // subtítulo
      const sp = E('outExpo')(clamp((t - 39.15) / 0.6));
      set(this.sub, { o: sp, y: (1 - sp) * 30 });
      // selo e CTA
      const bp = spr(t - 39.65, 2.4, 0.5), cp = spr(t - 39.85, 2.4, 0.5);
      set(this.badge, { s: t < 39.65 ? 0 : bp, o: t < 39.65 ? 0 : 1 });
      const tapA = t - 40.6;
      const press = tapA > 0 && tapA < 0.35 ? 1 - Math.sin(tapA / 0.35 * Math.PI) * 0.06 : 1;
      set(this.cta, { s: (t < 39.85 ? 0 : cp) * press, o: t < 39.85 ? 0 : 1 });
      const pr = this.pillc.getBoundingClientRect();
      const tp = clamp(tapA / 0.6);
      set(this.tap, { x: pr.width * 0.62, y: pr.height / 2, s: 0.2 + E('out3')(tp) * 6, o: tapA > 0 && tp < 1 ? (1 - tp) * 0.8 : 0 });
      // reflexo de luz atravessando
      const sw = clamp((t - 41.05) / 0.9);
      set(this.sweep, { x: E('io2')(sw) * W * 2.5, o: sw > 0 && sw < 1 ? 1 : 0 });
      // poeira de luz
      this.dust.forEach((el, i) => {
        const d = dust[i];
        const y = ((d.y - (t - HIT) * d.v) % H + H) % H;
        set(el, { y: y - d.y, x: Math.sin(t * 0.7 + d.ph) * 12, o: a < 0 ? 0 : clamp(a / 0.8) * (0.25 + 0.35 * Math.abs(Math.sin(t * 1.5 + d.ph))) });
      });
    },
  });
})();
