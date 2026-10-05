// Cena 2b · O drop (5,0s): o ponto explode na faísca de IA, que voa e vira o avatar do chat.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, rng, cue } = SR;
  const CX = W / 2, CY = H / 2;
  const R = rng(99);
  const parts = [];
  for (let i = 0; i < 46; i++) {
    const a = R() * Math.PI * 2, v = 900 + R() * 1700;
    parts.push({ a, v, s: 4 + R() * 12, c: ['#3FD0FF', '#7B5CFF', '#EF4F24', '#ffffff', '#E6F76A'][i % 5], d: R() * 0.06 });
  }
  SR.scene({
    id: 's02', start: 4.95, end: 5.75, z: 5,
    build(root) {
      this.flare = add(root, `<div class="abs" style="left:${-W * 0.25}px;top:${CY - 5}px;width:${W * 1.5}px;height:10px;border-radius:10px;background:linear-gradient(90deg, transparent, rgba(63,208,255,.0) 10%, rgba(160,220,255,.95) 48%, #fff 50%, rgba(160,220,255,.95) 52%, rgba(123,92,255,0) 90%, transparent)"></div>`);
      this.rings = [0, 1, 2].map(i => add(root, `<div class="abs" style="left:${CX - 120}px;top:${CY - 120}px;width:240px;height:240px;border-radius:50%;border:${6 - i * 1.5}px solid ${['#ffffff', '#3FD0FF', '#7B5CFF'][i]}"></div>`));
      this.parts = parts.map(p => add(root, `<div class="abs" style="left:${CX}px;top:${CY}px;width:${p.s}px;height:${p.s}px;margin:-${p.s / 2}px;border-radius:50%;background:${p.c};box-shadow:0 0 ${p.s * 2}px ${p.c}"></div>`));
      // a faísca (estrela de 4 pontas da IA)
      this.spark = add(root, `<div class="abs" style="left:${CX - 260}px;top:${CY - 260}px;width:520px;height:520px">
        <div class="abs" style="inset:-40%;border-radius:50%;background:radial-gradient(closest-side, rgba(150,200,255,.75), rgba(123,92,255,.25) 50%, transparent 72%)"></div>
        <svg class="abs" style="inset:0" viewBox="0 0 24 24"><defs><linearGradient id="spg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7FE8FF"/><stop offset=".55" stop-color="#8E6BFF"/><stop offset="1" stop-color="#6A3FFF"/></linearGradient></defs>
        <path fill="url(#spg)" d="M12 0c.9 6.2 5.8 11.1 12 12-6.2.9-11.1 5.8-12 12-.9-6.2-5.8-11.1-12-12C6.2 11.1 11.1 6.2 12 0z"/>
        <path fill="#fff" opacity=".9" transform="translate(12 12) scale(.38) translate(-12 -12)" d="M12 0c.9 6.2 5.8 11.1 12 12-6.2.9-11.1 5.8-12 12-.9-6.2-5.8-11.1-12-12C6.2 11.1 11.1 6.2 12 0z"/></svg></div>`);
      SR.flashAt(5.0, 0.32, '#ffffff', 0.92);
      SR.leakAt(4.96, 1.1, ['#7B5CFF', '#3FD0FF'], 0.75);
      SR.shakeAt(5.0, 0.45, 18);
      cue(5.0, 'impact', { gain: 1 });
      cue(5.02, 'shimmer', { gain: 0.6 });
      cue(5.3, 'whooshUp', { gain: 0.5 });
    },
    update(t) {
      const pf = clamp((t - 5.0) / 0.45);
      set(this.flare, { o: t < 5.0 ? 0 : (1 - E('out2')(pf)), sy: 1 + (1 - pf) * 1.5 });
      this.rings.forEach((r, i) => {
        const p = clamp((t - 5.0 - i * 0.06) / 0.7);
        set(r, { s: 0.2 + E('outExpo')(p) * (9 + i * 2), o: p > 0 && p < 1 ? (1 - p) * 0.9 : 0 });
      });
      this.parts.forEach((el, i) => {
        const p = parts[i];
        const dt = Math.max(0, t - 5.0 - p.d);
        const dist = (p.v / 3.2) * (1 - Math.exp(-3.2 * dt));
        set(el, { x: Math.cos(p.a) * dist, y: Math.sin(p.a) * dist, o: dt > 0 ? Math.max(0, 1 - dt / 0.7) : 0, s: 1 - dt });
      });
      // faísca: explode, gira, encolhe e voa até o avatar do chat
      const tgt = SR.chatAvatar ? SR.chatAvatar() : { x: CX, y: CY, size: 76 };
      const grow = spr(t - 5.0, 2.2, 0.5);
      const fly = E('io4')(clamp((t - 5.24) / 0.36));
      const size = 520 * grow * (1 - fly) + tgt.size * 1.15 * fly;
      const s = size / 520;
      const x = CX + (tgt.x - CX) * fly - Math.sin(fly * Math.PI) * (V ? 120 : 160);
      const y = CY + (tgt.y - CY) * fly - Math.sin(fly * Math.PI) * 90;
      set(this.spark, { x: x - CX, y: y - CY, s, r: (1 - Math.min(1, grow)) * -90 + fly * 135 + (t - 5) * 40, o: t < 5.0 ? 0 : 1 - clamp((t - 5.58) / 0.08) });
    },
  });
})();
