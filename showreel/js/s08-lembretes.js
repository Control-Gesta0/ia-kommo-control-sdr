// Cena 8 · Lembretes e tarefas (21–23s): avisos em cascata e o sino dourado tocando.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, cue, Z } = SR;
  const SL = Z.stage.cx - Z.stage.w / 2, ST = Z.stage.cy - Z.stage.h / 2;
  const ITEMS = [
    ['bell', '#F5A623', 'Lembrete enviado à cliente', '24h antes · quinta, 15h', 21.08],
    ['bell', '#F5A623', 'Lembrete enviado à cliente', '1h antes · com o link do Meet', 21.32],
    ['task', '#4C8BF7', 'Tarefa criada para o vendedor', 'Preparar proposta · Aurora Estética', 21.56],
    ['calendar', '#7B5CFF', 'Agenda do vendedor atualizada', 'Qui 15:00 · Apresentação', 21.8],
  ];
  SR.scene({
    id: 's08', start: 20.95, end: 23.15,
    build(root) {
      this.hl = SR.Headline(root, [['Ninguém'], ['esquece', { t: 'nada.', c: 'em' }]]);
      this.stage = SR.Stage(root);
      this.items = ITEMS.map(([ic, col, t1, t2], i) => add(this.stage, `<div class="panel" style="left:${V ? 40 : 30}px;top:${70 + i * 186}px;width:${V ? 880 : 900}px;height:160px;border-radius:30px;display:flex;align-items:center;gap:26px;padding:0 32px">
        <div style="width:96px;height:96px;flex:none;border-radius:26px;background:${col};color:#fff;display:grid;place-items:center;box-shadow:0 12px 26px ${col}66">${ICON(ic, '', 'width:50px;height:50px')}</div>
        <div style="flex:1;min-width:0"><div style="font:800 34px var(--fig);color:#1b1f2a;white-space:nowrap">${t1}</div><div style="font:400 28px var(--ui);color:#6b737b;margin-top:4px;white-space:nowrap">${t2}</div></div>
        <svg class="ck" viewBox="0 0 40 40" style="width:58px;height:58px;flex:none"><circle cx="20" cy="20" r="18" fill="#18B26B"/><polyline points="11.5 20.5 17.5 26.5 29 14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`));
      this.bell = add(root, SR.char('bell-gold', 230, `left:${V ? W - 300 : SL + 760}px;top:${V ? ST - 110 : ST - 60}px`));
      ITEMS.forEach(it => cue(it[4], 'notif', { gain: 0.75 }));
      cue(21.0, 'bell', { gain: 0.8 });
    },
    update(t) {
      this.hl.update(t, 21.05, 22.74);
      const out = E('in3')(clamp((t - 22.72) / 0.3));
      this.items.forEach((el, i) => {
        const ti = ITEMS[i][4];
        const p = E('outExpo')(clamp((t - ti) / 0.55));
        const ck = el.querySelector('.ck');
        set(el, { x: (1 - p) * 700 - out * (i % 2 ? -400 : 400), r: (1 - p) * 8, o: Math.min(1, p * 2) * (1 - out) });
        set(ck, { s: t < ti + 0.25 ? 0 : spr(t - ti - 0.25, 3, 0.45) });
      });
      // sino tocando
      const ring = t > 21.0 && t < 22.6 ? Math.sin((t - 21.0) * 34) * 16 * Math.exp(-(t - 21.0) * 1.2) : 0;
      SR.cameo(this.bell, t, 20.98, 22.7, { r: ring, wig: 0, bob: 6, dy: -80 });
    },
  });
})();
