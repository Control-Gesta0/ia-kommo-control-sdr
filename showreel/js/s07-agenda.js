// Cena 7 · Reunião marcada na agenda do vendedor (17,5–21s): o "15h" sai do chat e cai na agenda do Kommo.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, cue, Z } = SR;
  const SL = Z.stage.cx - Z.stage.w / 2, ST = Z.stage.cy - Z.stage.h / 2;
  const CAL = { x: 20, y: 250, w: 920, h: 450 }; // dentro do palco
  const HOURS = ['13:00', '14:00', '15:00', '16:00'];
  const DAYS = ['Qua 7', 'Qui 8', 'Sex 9'];
  const RH = 78, HDR = 70, DH = 54, GX = 110;
  const COLW = (CAL.w - GX) / 3;
  const LAND = 18.78;

  SR.scene({
    id: 's07', start: 17.45, end: 21.1,
    build(root) {
      this.hlA = SR.Headline(root, [['Reunião'], [{ t: 'marcada.', c: 'ai' }]]);
      this.hlB = SR.Headline(root, [['Na', 'agenda', 'do'], [{ t: 'vendedor.', c: 'em' }]]);
      this.stage = SR.Stage(root);
      // trecho do chat
      this.b1 = add(this.stage, `<div class="bub in" style="left:20px;top:0;max-width:640px;transform-origin:0 100%"><div class="who" style="color:#5F43D0">${SR.spark(24)}Agente de IA</div>Tenho quinta 15h ou sexta 10h. Qual prefere?<span class="meta">10:02</span></div>`);
      this.b2 = add(this.stage, `<div class="bub out" style="right:20px;top:150px;background:#D9FDD3;color:#1d2b22;transform-origin:100% 100%">Quinta, <span class="h15" style="background:linear-gradient(90deg,#E6F76A,#6FF0D2);border-radius:8px;padding:0 6px">15h</span>! ✅<span class="meta">10:03 <span style="color:#3FA2FF">✓✓</span></span></div>`);
      this.h15 = this.b2.querySelector('.h15');
      // agenda (recriação da semana do Kommo)
      this.cal = add(this.stage, `<div class="panel" style="left:${CAL.x}px;top:${CAL.y}px;width:${CAL.w}px;height:${CAL.h}px;border-radius:24px;background:#fff">
        <div style="position:absolute;left:0;right:0;top:0;height:${HDR}px;display:flex;align-items:center;gap:16px;padding:0 22px;border-bottom:1px solid #eceef1;font-family:var(--ui)">
          <span style="color:#4C8BF7">${ICON('calendar', '', 'width:26px;height:26px')}</span><b style="font-size:22px;color:#2c343c">5 – 11 Out. 2026</b><span style="font-size:20px;color:#2c343c">Semana ⌄</span>
          <span style="background:#CFE3A7;padding:5px 10px;border-radius:4px;font-size:18px;color:#2c3a14">Meus eventos</span><span style="flex:1"></span>
          <span style="background:#4C8BF7;color:#fff;border-radius:4px;padding:8px 14px;font:700 16px var(--ui)">+ NOVO EVENTO</span></div>
        <div class="days" style="position:absolute;left:0;right:0;top:${HDR}px;height:${DH}px;font-family:var(--ui)"></div>
        <div class="grid" style="position:absolute;left:0;right:0;top:${HDR + DH}px;bottom:0"></div></div>`);
      const days = this.cal.querySelector('.days'), grid = this.cal.querySelector('.grid');
      add(days, `<div class="abs" style="left:0;width:${GX}px;top:16px;text-align:center;font-size:16px;color:#8a9097">GMT-3</div>`);
      DAYS.forEach((d, i) => add(days, `<div class="abs" style="left:${GX + i * COLW}px;width:${COLW}px;top:14px;text-align:center;font-size:21px;color:${i === 1 ? '#4C8BF7' : '#5d656d'};font-weight:${i === 1 ? 700 : 400}">${d}</div>`));
      this.lines = [];
      HOURS.forEach((hh, i) => {
        add(grid, `<div class="abs" style="left:0;width:${GX - 14}px;top:${i * RH - 10}px;text-align:right;font:400 18px var(--ui);color:#8a9097">${hh}</div>`);
        this.lines.push(add(grid, `<div class="abs" style="left:${GX}px;right:0;top:${i * RH}px;height:1px;background:#e6e8ec;transform-origin:0 50%"></div>`));
      });
      [0, 1, 2].forEach(i => this.lines.push(add(grid, `<div class="abs" style="left:${GX + i * COLW}px;top:0;bottom:0;width:1px;background:#eef0f3;transform-origin:50% 0"></div>`)));
      // eventos existentes
      const ev = (d, h0, h1, txt, sub, bg, fg) => add(grid, `<div class="abs" style="left:${GX + d * COLW + 6}px;top:${h0 * RH + 4}px;width:${COLW - 12}px;height:${(h1 - h0) * RH - 8}px;border-radius:10px;background:${bg};color:${fg};padding:8px 12px;font:700 18px var(--ui);overflow:hidden">${txt}<div style="font-weight:400;font-size:16px;opacity:.85">${sub}</div></div>`);
      this.evs = [ev(0, 0, 1, '13:00 · Demo', 'Studio Lume', '#DCE8FF', '#2856A8'), ev(2, 1, 2, '14:00 · Reunião', 'Grupo Alfa', '#ECE6FF', '#4B34A8'), ev(0, 3, 3.9, '16:00 · Retorno', 'Fit Center', '#DCE8FF', '#2856A8')];
      // o novo evento
      this.newEv = add(grid, `<div class="abs" style="left:${GX + COLW + 6}px;top:${2 * RH + 4}px;width:${COLW - 12}px;height:${RH * 1.0 - 8}px;border-radius:12px;background:linear-gradient(135deg,#8E6BFF,#5F43D0);color:#fff;padding:9px 12px;font:700 19px var(--ui);transform-origin:50% 50%;box-shadow:0 10px 26px rgba(95,67,208,.55);overflow:hidden">
        15:00 · Apresentação<div style="font-weight:400;font-size:16px;opacity:.92;display:flex;align-items:center;gap:6px">${ICON('video', '', 'width:18px;height:18px')}Camila · Meet</div></div>`);
      this.sent = add(this.stage, `<div class="chipx" style="position:absolute;left:0;top:0;background:#18B26B;color:#fff;font-size:21px;padding:8px 14px;box-shadow:0 10px 24px rgba(24,178,107,.45)">${ICON('check', '', 'width:20px;height:20px')}convite enviado</div>`);
      // linha do histórico (como no Kommo)
      this.feed = add(this.stage, `<div class="panel" style="left:20px;top:${CAL.y + CAL.h + 22}px;width:${CAL.w}px;height:${V ? 196 : 190}px;border-radius:22px;background:#F5F5F5;padding:18px 24px;font:400 21px/1.5 var(--ui);color:#5d656d">
        <div class="fl" style="white-space:nowrap">Agora · <b style="color:#5F43D0">Agente de IA</b> · Movido para: <span style="border:1px solid #d5d9dd;background:#fff;padding:1px 8px;border-radius:3px;color:#2c343c">Funil SDR</span><span style="background:#99CCFF;padding:1px 8px;border-radius:3px;color:#1d3a5c">APRESENTAÇÃO AGENDADA</span></div>
        <div class="fl" style="margin-top:8px">⏰ Quinta 08/10 às 15h · reunião de 30 a 45 min</div>
        <div class="fl">⭐ Especialista: Rafael (vendas) · ➡️ <span style="color:#1F6FD1;text-decoration:underline">meet.google.com/abc-defg-hij</span></div></div>`);
      this.fls = [...this.feed.querySelectorAll('.fl')];
      this.tok = add(root, `<div class="abs" style="left:0;top:0;padding:2px 12px;border-radius:10px;background:linear-gradient(90deg,#E6F76A,#6FF0D2);color:#0E0142;font:800 34px var(--ui);box-shadow:0 14px 34px rgba(0,0,0,.4);opacity:0">15h</div>`);
      cue(17.62, 'popIn', { gain: 0.7 }); cue(17.98, 'popOut', { gain: 0.8 });
      cue(18.28, 'whooshS', { gain: 0.6 }); cue(LAND, 'thunk', { gain: 1 }); cue(19.02, 'chime', { gain: 0.6, pitch: 2 });
      cue(19.4, 'typing', { dur: 0.7, gain: 0.35 });
      SR.shakeAt(LAND, 0.25, 7);
    },
    update(t) {
      this.hlA.update(t, 17.55, 18.98);
      this.hlB.update(t, 19.36, 20.85);
      const out = E('in3')(clamp((t - 20.82) / 0.28));
      const stIn = E('outExpo')(clamp((t - 17.47) / 0.5));
      set(this.stage, { y: (1 - stIn) * 80 - out * 100, o: Math.min(1, stIn * 1.5) * (1 - out) });
      // bolhas
      [[this.b1, 17.62], [this.b2, 17.98]].forEach(([b, tb]) => {
        const p = spr(t - tb, 2.7, 0.55);
        set(b, { s: t < tb ? 0.6 : 0.6 + 0.4 * p, o: t < tb ? 0 : Math.min(1, (t - tb) * 8) });
      });
      // agenda se desenha
      const ci = E('outExpo')(clamp((t - 17.6) / 0.5));
      set(this.cal, { y: (1 - ci) * 60, o: ci });
      this.lines.forEach((l, i) => {
        const p = E('out3')(clamp((t - 17.75 - i * 0.04) / 0.4));
        l.style.transform = i < HOURS.length ? `scaleX(${p.toFixed(3)})` : `scaleY(${p.toFixed(3)})`;
      });
      this.evs.forEach((e, i) => set(e, { o: clamp((t - 18.0 - i * 0.08) / 0.2), s: 0.9 + 0.1 * E('outBack')(clamp((t - 18.0 - i * 0.08) / 0.3)) }));
      // ficha "15h" voando até a agenda
      const t0 = 18.28;
      const src = this.h15.getBoundingClientRect();
      const dst = this.newEv.getBoundingClientRect();
      if (t >= t0 - 0.1 && t < LAND + 0.05) {
        const p = E('io3')(clamp((t - t0) / (LAND - t0)));
        const sx = src.left + src.width / 2, sy = src.top + src.height / 2;
        const dx = dst.left + dst.width / 2, dy = dst.top + dst.height / 2;
        const [x, y] = SR.bez([sx, sy], [Math.max(sx, dx) + 160, (sy + dy) / 2 - 60], [dx, dy], p);
        const lift = E('out3')(clamp((t - t0 + 0.1) / 0.1));
        set(this.tok, { x: x - this.tok.offsetWidth / 2, y: y - this.tok.offsetHeight / 2, s: (1 + lift * 0.25) * (1 + Math.sin(p * Math.PI) * 0.2), r: Math.sin(p * Math.PI) * 14, o: 1 });
      } else set(this.tok, { o: 0 });
      this.h15.style.opacity = t >= t0 ? 0.25 : 1;
      // novo evento: estica e assenta (squash & stretch)
      const pe = t - LAND;
      if (pe < 0) set(this.newEv, { o: 0, s: 0.2 });
      else {
        const sq = Math.exp(-pe * 7) * Math.sin(pe * 26);
        set(this.newEv, { o: 1, sx: 1 + sq * 0.12, sy: 1 - sq * 0.16, s: Math.min(1, 0.3 + pe * 6) });
        this.newEv.style.boxShadow = `0 10px 26px rgba(95,67,208,.55), 0 0 0 ${(Math.max(0, 1 - pe * 2) * 10).toFixed(1)}px rgba(230,247,106,${(Math.max(0, 1 - pe * 2) * 0.8).toFixed(2)})`;
      }
      // selo "convite enviado"
      const sr = spr(t - 19.02, 2.8, 0.45);
      const stg = this.stage.getBoundingClientRect();
      set(this.sent, { x: dst.left - stg.left + dst.width - 40, y: dst.top - stg.top - 34, s: t < 19.02 ? 0 : sr, o: t < 19.02 ? 0 : 1 });
      // histórico
      const fi = E('outExpo')(clamp((t - 19.3) / 0.45));
      set(this.feed, { y: (1 - fi) * 50, o: fi });
      this.fls.forEach((f, i) => { const p = clamp((t - 19.42 - i * 0.28) / 0.25); f.style.opacity = p.toFixed(2); f.style.transform = `translateX(${((1 - E('out3')(p)) * 24).toFixed(1)}px)`; });
    },
  });
})();
