// Cenas 1+2 · O caos (0–3s) e a virada (3–5s): notificações multiplicam, o tempo congela,
// tudo implode num ponto de luz.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, rng, wob, shake, cue, esc } = SR;
  const CX = W / 2, CY = H / 2;
  const R = rng(4711);

  const MSGS = [
    ['Camila Rocha', 'Oi! Vocês atendem hoje ainda?', 'whatsapp'],
    ['Marcos Lima', 'Qual o valor do plano?', 'instagram'],
    ['Juliana P.', 'Tem horário amanhã cedo?', 'whatsapp'],
    ['Rafael S.', 'Alguém aí??', 'fb'],
    ['Bianca Torres', 'Vocês parcelam?', 'whatsapp'],
    ['Diego M.', 'Vi o anúncio, quero saber mais', 'tiktok'],
    ['Patrícia', 'Ainda tá disponível?', 'instagram'],
    ['Lucas F.', 'Me liga quando puder', 'whatsapp'],
    ['Ana Clara', 'Oi, boa noite!', 'telegram'],
    ['Fernanda R.', 'Quanto fica pra 8 pessoas?', 'whatsapp'],
    ['Thiago', 'Vocês atendem minha cidade?', 'fb'],
    ['Renata L.', 'Mandei áudio, ouve lá', 'whatsapp'],
    ['Gustavo', 'Preciso pra essa semana', 'instagram'],
    ['Carla M.', 'Oi?', 'whatsapp'],
    ['Eduardo', 'Tem desconto à vista?', 'tiktok'],
    ['Sofia A.', 'Quero agendar uma visita', 'whatsapp'],
    ['Bruno K.', 'Ninguém responde aqui 😕', 'instagram'],
    ['Larissa', 'Ainda tem vaga?', 'whatsapp'],
    ['Pedro H.', 'Pode me mandar o catálogo?', 'telegram'],
    ['Aline S.', 'Oii, tudo bem?', 'whatsapp'],
  ];

  // Posições espalhadas pela tela inteira (determinísticas)
  const N = V ? 34 : 34;
  const items = [];
  for (let i = 0; i < N; i++) {
    const m = MSGS[i % MSGS.length];
    // aparecem acelerando de 0,75s a 2,9s
    const u = i / (N - 1);
    const tin = i === 0 ? 0.12 : 0.72 + Math.pow(u, 0.62) * 2.15;
    let x, y;
    if (i === 0) { x = CX; y = V ? 330 : 170; }
    else { x = 80 + R() * (W - 160); y = (V ? 120 : 70) + R() * (H - (V ? 240 : 140)); }
    items.push({ m, tin, x, y, r: i === 0 ? 0 : (R() - 0.5) * 16, s: i === 0 ? 1.34 : 0.92 + R() * 0.36, z: R(), dist: Math.hypot(x - CX, y - CY) });
  }
  const maxD = Math.max(...items.map(i => i.dist));

  SR.scene({
    id: 's01', start: 0, end: 5.06,
    build(root) {
      this.layer = add(root, `<div class="abs" style="inset:0"></div>`);
      this.streaks = add(root, `<div class="abs" style="inset:0"></div>`);
      items.forEach((it, i) => {
        it.el = add(this.layer, `<div class="notif" style="left:0;top:0;transform-origin:50% 50%">
          <img src="assets/kommo/ch-${it.m[2]}.png"><div class="tx"><div class="t1">${esc(it.m[0])}<span>agora</span></div><div class="t2">${esc(it.m[1])}</div></div></div>`);
        it.st = add(this.streaks, `<div class="abs" style="left:0;top:0;height:4px;border-radius:4px;transform-origin:0 50%;background:linear-gradient(90deg, rgba(255,255,255,0), rgba(180,170,255,.9));opacity:0"></div>`);
        cue(it.tin, 'ping', { gain: i === 0 ? 1 : 0.35 + 0.25 * it.z, pitch: i === 0 ? 0 : (it.z - 0.5) * 6, pan: (it.x / W - 0.5) * 1.4 });
      });
      // contador de não lidas
      this.badge = add(root, `<div class="abs c" style="left:${CX - 90}px;top:${V ? 150 : 40}px;width:180px;height:84px;border-radius:42px;background:#FF3D60;color:#fff;font:900 52px var(--fig);box-shadow:0 0 40px rgba(255,61,96,.7)"><span>0</span></div>`);
      this.badgeTxt = this.badge.querySelector('span');

      const big = V ? 300 : 290;
      this.t1 = add(root, `<div class="abs" style="left:0;right:0;top:${CY - big * 0.6}px;text-align:center;font:900 ${big}px/1 var(--fig);letter-spacing:-.05em;color:#fff;text-shadow:0 10px 60px rgba(0,0,0,.8)">23h47.</div>`);
      const s2 = V ? 124 : 118;
      this.t2 = add(root, `<div class="abs" style="left:0;right:0;top:${CY - s2 * 1.05}px;text-align:center;font:900 ${s2}px/1.0 var(--fig);letter-spacing:-.045em;color:#fff;text-shadow:0 10px 60px rgba(0,0,0,.85)"><div class="ln" style="overflow:hidden;padding-bottom:.1em"><span class="w" style="display:inline-block">47 mensagens</span></div><div class="ln" style="overflow:hidden;padding-bottom:.1em"><span class="w" style="display:inline-block">não lidas.</span></div></div>`);
      const s3 = V ? 150 : 140;
      const glitchTxt = `<div>Ninguém</div><div>responde.</div>`;
      this.t3 = add(root, `<div class="abs" style="left:0;right:0;top:${CY - s3 * 1.0}px;text-align:center;font:900 ${s3}px/0.98 var(--fig);letter-spacing:-.045em">
        <div class="abs gR" style="left:0;right:0;top:0;color:#ff2a55;mix-blend-mode:screen">${glitchTxt}</div>
        <div class="abs gC" style="left:0;right:0;top:0;color:#28e7ff;mix-blend-mode:screen">${glitchTxt}</div>
        <div class="gW" style="position:relative;color:#fff;text-shadow:0 10px 60px rgba(0,0,0,.85)">${glitchTxt}</div></div>`);
      this.gR = this.t3.querySelector('.gR'); this.gC = this.t3.querySelector('.gC'); this.gW = this.t3.querySelector('.gW');
      const s4 = V ? 150 : 140;
      this.t4 = add(root, `<div class="abs" style="left:0;right:0;top:${V ? CY - 470 : CY - 330}px;text-align:center;font:900 ${s4}px/1 var(--fig);letter-spacing:-.045em;color:#fff">
        <span class="w" style="display:inline-block">Até</span> <span class="w" style="display:inline-block;background:linear-gradient(95deg,#7FE3FF,#9C84FF);-webkit-background-clip:text;background-clip:text;color:transparent">agora.</span></div>`);
      this.t4w = [...this.t4.querySelectorAll('.w')];
      // anel do congelamento
      this.ring = add(root, `<div class="abs" style="left:${CX - 100}px;top:${CY - 100}px;width:200px;height:200px;border-radius:50%;border:3px solid rgba(200,220,255,.8);opacity:0"></div>`);
      // ponto de luz
      this.core = add(root, `<div class="abs" style="left:${CX - 300}px;top:${CY - 300}px;width:600px;height:600px;border-radius:50%;opacity:0;
        background:radial-gradient(closest-side, #fff 0%, #fff 7%, rgba(160,200,255,.95) 10%, rgba(123,92,255,.55) 26%, rgba(239,79,36,.22) 45%, rgba(0,0,0,0) 70%)"></div>`);

      cue(0.5, 'hit', { gain: 0.9 });
      cue(1.25, 'hit', { gain: 0.8, pitch: 2 });
      cue(2.0, 'glitch', { gain: 0.9 });
      cue(3.0, 'tapestop', { gain: 0.9 });
      cue(3.05, 'suck', { gain: 0.9, dur: 1.0 });
      cue(3.6, 'soft', { gain: 0.7 });
      cue(4.0, 'boom', { gain: 0.7 });
      SR.shakeAt(0.5, 0.35, 16);
      SR.shakeAt(1.25, 0.3, 10);
      SR.shakeAt(2.0, 0.9, 12);
      SR.flashAt(4.0, 0.35, '#cfd8ff', 0.35);
    },
    update(t) {
      const FREEZE = 3.0;
      const tf = Math.min(t, FREEZE); // tempo congelado depois de 3s
      // notificações
      let count = 0;
      const glitchAmt = k(t, [2.0, 0], [2.08, 1], [2.3, 0.35], [2.9, 0.8], [3.0, 0]);
      items.forEach((it, i) => {
        const a = tf - it.tin;
        if (t < it.tin) { set(it.el, { o: 0, s: 0 }); set(it.st, { o: 0 }); return; }
        count++;
        const p = spr(a, 2.6, 0.48);
        let x = it.x, y = it.y, s = it.s * p, r = it.r * p, o = Math.min(1, a * 8);
        if (i === 0) y = k(tf, [0.12, it.y - 220], [0.5, it.y, 'outBack']);
        // jitter do caos
        const jit = glitchAmt * 10;
        x += wob(tf * 9, i) * jit; y += wob(tf * 8, i + 3) * jit;
        // implosão: de 3,2s a 4,0s, de fora para dentro
        const d0 = 3.18 + (1 - it.dist / maxD) * 0.22;
        const pim = clamp((t - d0) / (4.0 - d0));
        const ei = E('inExpo')(pim);
        const nx = x + (CX - x) * ei, ny = y + (CY - y) * ei;
        const sc = s * (1 - ei * 0.96);
        const rot = r + ei * (it.z > 0.5 ? 220 : -220);
        set(it.el, { x: nx - 320, y: ny - 50, s: sc, r: rot, o: o * (1 - clamp((pim - 0.9) / 0.1)) });
        // rastros de luz durante a implosão
        if (pim > 0.02 && pim < 1) {
          const len = Math.hypot(x - nx, y - ny) * 0.9;
          const ang = Math.atan2(CY - ny, CX - nx) * 180 / Math.PI + 180;
          set(it.st, { x: nx, y: ny - 2, r: ang, o: Math.sin(pim * Math.PI) * 0.9, w: Math.max(4, len) });
        } else set(it.st, { o: 0 });
      });
      // congelamento: dessatura
      const fz = k(t, [2.98, 0], [3.06, 1, 'out2']);
      this.layer.style.filter = fz > 0.01 ? `grayscale(${fz}) brightness(${1 - fz * 0.25}) contrast(${1 + fz * 0.1})` : 'none';

      // contador
      const shown = t < 0.72 ? (t > 0.12 ? 1 : 0) : Math.min(99, Math.round(count * 2.9));
      const lab = shown >= 99 ? '99+' : String(shown);
      if (this.badgeTxt.__v !== lab) { this.badgeTxt.textContent = lab; this.badgeTxt.__v = lab; }
      const bump = count > 0 ? 1 + 0.12 * Math.exp(-((tf - (items[Math.max(0, count - 1)].tin)) * 18)) : 1;
      const bIn = spr(t - 0.72, 2.5, 0.45);
      const bOut = E('inExpo')(clamp((t - 3.25) / 0.6));
      set(this.badge, { s: Math.max(0, bIn * bump * (1 - bOut)), o: t < 0.72 ? 0 : 1 - bOut, y: bOut * (CY - (V ? 150 : 40) - 42) });

      // texto 1: 23h47.
      const p1 = clamp((t - 0.5) / 0.28), e1 = E('outExpo')(p1), out1 = E('in3')(clamp((t - 1.12) / 0.16));
      set(this.t1, { s: 1.45 - 0.45 * e1 + out1 * 0.2, o: p1 > 0 ? (1 - out1) : 0, blur: (1 - e1) * 18 + out1 * 10, y: -out1 * 40 });
      // texto 2
      const w2 = this.t2.querySelectorAll('.w');
      w2.forEach((w, i) => {
        const p = E('outExpo')(clamp((t - 1.25 - i * 0.07) / 0.5));
        const o = E('in3')(clamp((t - 1.88 - i * 0.03) / 0.14));
        set(w, { y: (1 - p) * 140 - o * 140 });
      });
      set(this.t2, { o: t > 1.2 && t < 2.1 ? 1 : 0 });
      // texto 3: glitch
      const p3 = clamp((t - 2.0) / 0.2), e3 = E('outExpo')(p3);
      const wipe = clamp((t - 3.25) / 0.3);
      const vis3 = t >= 2.0 && wipe < 1;
      const gx = glitchAmt * 14 + (t > 2 && t < 3 ? Math.abs(wob(t * 30, 2)) * 6 : 0);
      set(this.t3, { o: vis3 ? 1 : 0, s: 1.2 - 0.2 * e3, clip: `inset(0 0 0 ${(E('io3')(wipe) * 100).toFixed(1)}%)` });
      set(this.gR, { x: -gx, y: wob(t * 41, 1) * glitchAmt * 6, o: Math.min(1, glitchAmt * 1.4) });
      set(this.gC, { x: gx, y: wob(t * 37, 5) * glitchAmt * 6, o: Math.min(1, glitchAmt * 1.4) });
      const slice = glitchAmt > 0.5 && Math.floor(t * 30) % 3 === 0;
      set(this.gW, { x: slice ? wob(t * 50, 9) * 18 : 0, skx: slice ? 6 : 0 });

      // anel de congelamento
      const pr = clamp((t - 3.0) / 0.5);
      set(this.ring, { s: 1 + E('out3')(pr) * 9, o: pr > 0 && pr < 1 ? (1 - pr) * 0.9 : 0 });

      // texto 4: "Até agora."
      this.t4w.forEach((w, i) => {
        const p = E('outExpo')(clamp((t - 3.6 - i * 0.12) / 0.55));
        set(w, { y: (1 - p) * 60, o: p, blur: (1 - p) * 12 });
      });
      const out4 = E('in3')(clamp((t - 4.92) / 0.12));
      set(this.t4, { o: t >= 3.6 ? 1 - out4 : 0, s: 1 + out4 * 0.3 + (t > 4.0 ? (t - 4.0) * 0.04 : 0) });

      // ponto de luz
      const pc = clamp((t - 3.5) / 0.5);
      const pulse = t > 4.0 ? 1 + Math.sin((t - 4.0) * 16) * 0.05 : 1;
      const pre = k(t, [4.0, 1], [4.55, 1], [4.98, 0.42, 'in3'], [5.06, 1.4, 'outExpo']);
      set(this.core, { o: E('in2')(pc), s: (0.2 + 0.8 * E('outBack')(pc)) * pulse * pre });
    },
  });
})();
