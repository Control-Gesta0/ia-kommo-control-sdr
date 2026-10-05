// Cena 12 · O ciclo completo (35–37s): os ícones de todas as etapas giram num anel cada vez mais rápido,
// os verbos piscam no ritmo dobrado e o anel se divide nos dois anéis do símbolo da Control Gestão.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, cue } = SR;
  const CX = W / 2, CY0 = V ? 900 : 540, R0 = V ? 360 : 330;
  // geometria final do símbolo (igual à cena 13)
  const LOGO = V ? { w: 720, cx: 540, cy: 700 } : { w: 560, cx: 960, cy: 360 };
  const sc = LOGO.w / 1330;
  const RING = { r: 301.5 * sc, sw: 105 * sc, cC: LOGO.cx - 665 * sc + 354 * sc, cG: LOGO.cx - 665 * sc + 955 * sc, cy: LOGO.cy - 354 * sc + 354 * sc };
  SR.LOGO = LOGO; SR.RING = RING;
  const ICS = ['chat', 'check', 'kanban', 'calendar', 'bell', 'contract', 'coin', 'receipt'];
  const VERBS = ['Atende.', 'Qualifica.', 'Move.', 'Agenda.', 'Lembra.', 'Assina.', 'Recebe.', 'Cobra.'];
  const T0 = 35.0, STEP = 0.25, SPLIT = 36.72, END = 37.0;

  SR.scene({
    id: 's12', start: 34.95, end: 37.06,
    build(root) {
      this.svg = add(root, `<svg class="abs" style="left:0;top:0;width:${W}px;height:${H}px;overflow:visible" viewBox="0 0 ${W} ${H}">
        <circle class="r0" cx="0" cy="0" r="${R0}" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="3" stroke-dasharray="${2 * Math.PI * R0}" stroke-dashoffset="${2 * Math.PI * R0}"/>
        <circle class="rA" cx="0" cy="0" r="10" fill="none" stroke="#fff" stroke-width="10" opacity="0"/>
        <circle class="rB" cx="0" cy="0" r="10" fill="none" stroke="#fff" stroke-width="10" opacity="0"/></svg>`);
      this.r0 = this.svg.querySelector('.r0'); this.rA = this.svg.querySelector('.rA'); this.rB = this.svg.querySelector('.rB');
      this.smear = add(root, `<div class="abs" style="left:${CX - R0 - 60}px;top:${CY0 - R0 - 60}px;width:${2 * R0 + 120}px;height:${2 * R0 + 120}px;border-radius:50%;
        background:conic-gradient(from 0deg, rgba(63,208,255,0), rgba(63,208,255,.65), rgba(123,92,255,.8), rgba(239,79,36,.75), rgba(63,208,255,0));
        -webkit-mask:radial-gradient(closest-side, transparent ${R0 - 70}px, #000 ${R0 - 40}px, #000 ${R0 + 40}px, transparent ${R0 + 60}px);opacity:0"></div>`);
      this.icons = ICS.map(ic => add(root, `<div class="abs c" style="left:${CX - 60}px;top:${CY0 - 60}px;width:120px;height:120px;border-radius:50%;background:rgba(20,18,60,.9);border:2.5px solid rgba(255,255,255,.35);color:#fff;box-shadow:0 0 30px rgba(123,92,255,.35)">${ICON(ic, '', 'width:56px;height:56px')}</div>`));
      this.verbs = VERBS.map((v, i) => add(root, `<div class="abs" style="left:0;right:0;top:${CY0 - (V ? 84 : 74)}px;text-align:center;font:900 ${V ? 150 : 132}px/1.1 var(--fig);letter-spacing:-.045em;opacity:0;${i % 2 ? 'background:linear-gradient(95deg,#FF9A5A,#EF4F24 50%,#FF3D60);-webkit-background-clip:text;background-clip:text;color:transparent' : 'color:#fff'}">${v}</div>`));
      VERBS.forEach((v, i) => cue(T0 + i * STEP, 'beatHit', { gain: 0.75, pitch: i }));
      cue(T0, 'riser', { dur: 2.0, gain: 0.8 });
      cue(36.5, 'spinUp', { dur: 0.5, gain: 0.7 });
    },
    update(t) {
      const u = Math.max(0, t - T0);
      const theta = (20 * u + 37.5 * Math.pow(u, 4)) * Math.PI / 180;
      const speed = 20 + 1200 * Math.pow(Math.min(u, 2) / 2, 3);
      const draw = E('io3')(clamp((t - 34.98) / 0.45));
      const split = E('io3')(clamp((t - SPLIT) / (END - SPLIT)));
      const iconFade = clamp((speed - 260) / 600);
      // anel fino se desenha, depois engrossa e contrai até a geometria do símbolo
      const cy = CY0 + (RING.cy - CY0) * split;
      const r = R0 + (RING.r - R0) * split;
      this.r0.setAttribute('cx', CX); this.r0.setAttribute('cy', cy.toFixed(1)); this.r0.setAttribute('r', r.toFixed(1));
      this.r0.setAttribute('stroke-width', (3 + (RING.sw - 3) * clamp(iconFade * 0.4 + split)).toFixed(1));
      this.r0.setAttribute('stroke-dashoffset', (2 * Math.PI * R0 * (1 - draw)).toFixed(1));
      this.r0.setAttribute('stroke', `rgba(255,255,255,${(0.85 + 0.15 * split).toFixed(2)})`);
      this.r0.style.opacity = split > 0.02 ? 0 : 1;
      // os dois anéis que se separam
      [[this.rA, RING.cC], [this.rB, RING.cG]].forEach(([c, tx]) => {
        c.setAttribute('cx', (CX + (tx - CX) * split).toFixed(1)); c.setAttribute('cy', cy.toFixed(1));
        c.setAttribute('r', r.toFixed(1)); c.setAttribute('stroke-width', RING.sw.toFixed(1));
        c.setAttribute('opacity', split > 0.02 ? 1 : 0);
      });
      set(this.smear, { r: theta * 180 / Math.PI * 1.0, o: iconFade * (1 - split) * 0.9, y: (cy - CY0), s: r / R0 });
      // ícones em órbita
      this.icons.forEach((el, i) => {
        const a = theta + (i / ICS.length) * Math.PI * 2 - Math.PI / 2;
        const pin = spr(t - 35.0 - i * 0.035, 2.6, 0.5);
        const active = Math.floor((t - T0) / STEP) === i && t >= T0;
        const x = Math.cos(a) * r, y = Math.sin(a) * r + (cy - CY0);
        set(el, { x, y, s: Math.max(0, pin) * (active ? 1.22 : 1) * (1 - split), o: (1 - iconFade) * (t < 35.0 ? 0 : 1) });
        el.style.background = active ? 'linear-gradient(135deg,#FF9A5A,#EF4F24)' : 'rgba(20,18,60,.9)';
        el.style.boxShadow = active ? '0 0 46px rgba(239,79,36,.8)' : '0 0 30px rgba(123,92,255,.35)';
      });
      // verbos
      this.verbs.forEach((el, i) => {
        const ta = T0 + i * STEP;
        const p = clamp((t - ta) / 0.1);
        const vis = t >= ta && t < ta + STEP;
        set(el, { o: vis ? 1 - split : 0, s: vis ? 1.25 - 0.25 * E('out3')(p) : 1, blur: vis ? (1 - p) * 6 : 0, y: (cy - CY0) });
      });
    },
  });
})();
