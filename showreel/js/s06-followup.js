// Cena 6 · Follow-up (15,2–17,6s): o card fica cinza, a IA chama de volta em 4h, 1d e 3d, a lead responde.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, cue, Z, rng } = SR;
  const SX = Z.stage.cx, SY = Z.stage.cy;
  const CARD_Y = V ? SY - 270 : SY - 250;
  const FU = [
    ['4h', 'Oi, Camila! Conseguiu ver? 😊', 15.62],
    ['1d', 'Separei um case parecido com o seu 👀', 15.94],
    ['3d', 'Ainda faz sentido conversar?', 16.26],
  ];
  const REPLY = 16.6;
  const R = rng(321);
  const burst = Array.from({ length: 22 }, () => ({ a: R() * Math.PI * 2, v: 260 + R() * 360, s: 6 + R() * 10, c: ['#E6F76A', '#6FF0D2', '#EF4F24', '#3FD0FF'][Math.floor(R() * 4)] }));

  SR.scene({
    id: 's06', start: 15.24, end: 17.62,
    build(root) {
      this.hl = SR.Headline(root, [['Ninguém', 'fica'], [{ t: 'no vácuo.', c: 'em' }]]);
      this.burstRing = add(root, `<div class="abs" style="left:${SX - 150}px;top:${CARD_Y - 150}px;width:300px;height:300px;border-radius:50%;border:6px solid #E6F76A;opacity:0"></div>`);
      this.parts = burst.map(p => add(root, `<div class="abs" style="left:${SX}px;top:${CARD_Y}px;width:${p.s}px;height:${p.s}px;margin:-${p.s / 2}px;border-radius:3px;background:${p.c};opacity:0"></div>`));
      this.card = add(root, SR.kcard({ nome: 'Camila Rocha', empresa: 'Aurora Estética', ini: 'CR', tags: [['ia-sdr'], ['LEAD Kommo', 'p'], ['lead-quente', 'h']], dot: '#EF4F24' }, `left:${SX - 215}px;top:${SY - 75}px;width:430px;transform-origin:50% 50%`));
      this.status = add(root, `<div class="abs" style="left:0;top:0;display:flex;align-items:center;gap:10px;padding:10px 20px;border-radius:999px;font:700 26px var(--fig);white-space:nowrap"></div>`);
      this.tl = add(root, `<div class="abs" style="left:${SX - (V ? 430 : 420)}px;top:${CARD_Y + 170}px;width:${V ? 860 : 840}px;height:420px"></div>`);
      this.line = add(this.tl, `<div class="abs" style="left:34px;top:40px;width:4px;height:236px;border-radius:2px;background:rgba(255,255,255,.18);overflow:hidden"><div class="fill" style="width:100%;height:100%;background:linear-gradient(180deg,#3FD0FF,#7B5CFF);transform-origin:50% 0"></div></div>`);
      this.lineFill = this.line.querySelector('.fill');
      this.nodes = FU.map(([lab, txt], i) => {
        const row = add(this.tl, `<div class="abs" style="left:0;top:${i * 118}px;display:flex;align-items:center;gap:22px">
          <div class="nd c" style="width:72px;height:72px;border-radius:50%;border:3px solid rgba(255,255,255,.3);font:800 24px var(--fig);color:#fff;background:rgba(255,255,255,.06)">${lab}</div>
          <div class="bb bub in" style="position:relative;max-width:${V ? 720 : 700}px;padding:14px 20px 10px;font-size:28px">${txt}<span class="meta" style="display:flex;justify-content:space-between;gap:16px"><span style="color:#5F43D0;font-weight:700">✦ follow-up automático</span><span>enviado ✓✓</span></span></div></div>`);
        return { row, nd: row.querySelector('.nd'), bb: row.querySelector('.bb') };
      });
      this.reply = add(root, `<div class="bub out" style="right:${V ? 70 : W - (SX + 430)}px;top:${CARD_Y + 170 + 3 * 118 + 6}px;background:#D9FDD3;color:#1d2b22;font-size:31px;transform-origin:100% 100%">Desculpa a sumida! Bora marcar? 🙌<span class="meta">agora <span style="color:#3FA2FF">✓✓</span></span></div>`);
      this.glass = add(root, SR.char('searchglass', 150, `left:${SX + (V ? 200 : 240)}px;top:${CARD_Y - 200}px`));
      FU.forEach(([, , t]) => cue(t, 'popIn', { gain: 0.6, pitch: 3 }));
      cue(15.32, 'downTone', { gain: 0.5 });
      cue(REPLY, 'popOut', { gain: 0.9 }); cue(REPLY + 0.02, 'sparkle', { gain: 0.6 });
    },
    update(t) {
      this.hl.update(t, 15.26, 17.3);
      const mv = E('io3')(clamp((t - 15.26) / 0.4));
      const out = E('in3')(clamp((t - 17.3) / 0.3));
      const cs = 1.65 - 0.2 * mv;
      const pop = t >= REPLY ? 1 + Math.exp(-(t - REPLY) * 7) * Math.sin((t - REPLY) * 22) * 0.06 : 1;
      set(this.card, { x: 0, y: (CARD_Y - SY) * mv - out * 120, s: cs * pop, o: 1 - out });
      const gray = k(t, [15.3, 0], [15.55, 1], [REPLY, 1], [REPLY + 0.25, 0, 'out2']);
      this.card.style.filter = gray > 0.01 ? `grayscale(${gray.toFixed(2)}) brightness(${(1 - gray * 0.12).toFixed(2)})` : 'none';
      // selo de status sob o card
      const r = this.card.getBoundingClientRect();
      const replied = t >= REPLY;
      const html = replied ? `${ICON('checkCircle', '', 'width:28px;height:28px')}respondeu agora` : `${ICON('clock', '', 'width:28px;height:28px')}sem resposta há 2 dias`;
      if (this.status.__v !== html) { this.status.innerHTML = html; this.status.__v = html; }
      this.status.style.background = replied ? '#E2F7EC' : '#E4E6EC';
      this.status.style.color = replied ? '#11834B' : '#5d656d';
      const sp = spr(t - 15.4, 2.6, 0.5);
      set(this.status, { x: r.left + r.width / 2 - this.status.offsetWidth / 2, y: r.bottom - 8, s: t < 15.4 ? 0 : sp * (replied ? 1 + Math.exp(-(t - REPLY) * 8) * 0.15 : 1), o: (t < 15.4 ? 0 : 1) * (1 - out) });
      // linha do tempo
      const tlIn = clamp((t - 15.45) / 0.3);
      set(this.tl, { o: tlIn * (1 - out), y: (1 - E('out3')(tlIn)) * 40 - out * 80 });
      this.lineFill.style.transform = `scaleY(${E('io2')(clamp((t - 15.62) / 0.7)).toFixed(3)})`;
      this.nodes.forEach((n, i) => {
        const ta = FU[i][2];
        const on = t >= ta;
        n.nd.style.background = on ? 'linear-gradient(135deg,#3FD0FF,#7B5CFF)' : 'rgba(255,255,255,.06)';
        n.nd.style.borderColor = on ? 'transparent' : 'rgba(255,255,255,.3)';
        n.nd.style.boxShadow = on ? `0 0 ${(26 + Math.exp(-(t - ta) * 6) * 30).toFixed(0)}px rgba(123,92,255,.75)` : 'none';
        set(n.nd, { s: on ? 1 + Math.exp(-(t - ta) * 8) * 0.25 : 1 });
        const bp = spr(t - ta - 0.05, 2.6, 0.55);
        set(n.bb, { s: t < ta + 0.05 ? 0.6 : 0.6 + 0.4 * bp, o: t < ta + 0.05 ? 0 : Math.min(1, (t - ta - 0.05) * 7) * (replied ? 0.55 : 1) });
        n.bb.style.transformOrigin = '0% 100%';
      });
      // resposta
      const rp = spr(t - REPLY, 2.6, 0.5);
      set(this.reply, { s: t < REPLY ? 0.5 : 0.5 + 0.5 * rp, o: t < REPLY ? 0 : Math.min(1, (t - REPLY) * 8) * (1 - out), y: -out * 80 });
      // estouro de cor
      const bp2 = clamp((t - REPLY) / 0.6);
      set(this.burstRing, { y: r.top + r.height / 2 - CARD_Y, s: 0.5 + E('outExpo')(bp2) * 3.2, o: t >= REPLY && bp2 < 1 ? (1 - bp2) : 0 });
      this.parts.forEach((el, i) => {
        const p = burst[i], dt = t - REPLY;
        if (dt < 0 || dt > 0.8) { el.style.opacity = 0; return; }
        const d = p.v * (1 - Math.exp(-4 * dt)) / 1.2;
        set(el, { x: Math.cos(p.a) * d * 1.6, y: r.top + r.height / 2 - CARD_Y + Math.sin(p.a) * d + 200 * dt * dt, r: dt * 500, o: 1 - dt / 0.8 });
      });
      SR.cameo(this.glass, t, 15.35, 16.45, { r: -14, dx: 160, wig: 9 });
    },
  });
})();
