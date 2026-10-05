// Cena 11 · ERP e inadimplência (31–35s): painel financeiro, parcela vencida, cobrança no WhatsApp, pago.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, cue, Z, brl, intBR } = SR;
  const SL = Z.stage.cx - Z.stage.w / 2, ST = Z.stage.cy - Z.stage.h / 2;
  const ALERT = 32.3, MSG = 32.6, READ = 33.25, PIX = 33.55, PAID = 33.85;
  const BARS = [['Mai', 0.52], ['Jun', 0.61], ['Jul', 0.58], ['Ago', 0.72], ['Set', 0.8], ['Out', 0.94]];

  SR.scene({
    id: 's11', start: 30.88, end: 35.12,
    build(root) {
      this.hlA = SR.Headline(root, [[{ t: 'Atrasou?', c: 'grad' }], ['A', 'IA', 'cobra.']]);
      this.hlB = SR.Headline(root, [[{ t: 'Recebido.', c: 'ok' }]]);
      this.stage = SR.Stage(root);
      this.dash = add(this.stage, `<div class="abs" style="left:${V ? 30 : 20}px;top:0;width:${V ? 900 : 920}px;height:${V ? 700 : 720}px;border-radius:30px;background:linear-gradient(160deg,#16204A,#0C1233);border:1px solid rgba(255,255,255,.14);box-shadow:0 50px 110px rgba(0,0,0,.55);color:#fff;font-family:var(--fig);overflow:hidden">
        <div style="display:flex;align-items:center;gap:14px;padding:26px 30px 0">
          <span style="width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,#EF4F24,#FF9A5A);display:grid;place-items:center">${ICON('db', '', 'width:28px;height:28px')}</span>
          <div><div style="font:800 30px var(--fig)">ERP · Financeiro</div><div style="font:500 19px var(--fig);opacity:.6">Outubro 2026</div></div><span style="flex:1"></span>
          <span style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(24,178,107,.16);border:1px solid rgba(24,178,107,.5);font:700 18px var(--fig);color:#7CF0B0">${ICON('refresh', '', 'width:20px;height:20px')}sincronizado com o Kommo</span></div>
        <div class="kpis" style="display:flex;gap:16px;padding:22px 30px 0"></div>
        <div class="chart" style="position:absolute;left:30px;right:30px;top:268px;height:150px"></div>
        <div class="list" style="position:absolute;left:30px;right:30px;top:444px"></div></div>`);
      const kp = this.dash.querySelector('.kpis');
      this.kpis = [['Faturado', 186420, '#fff'], ['Recebido', 171300, '#7CF0B0'], ['Em aberto', 15120, '#FF8FA3']].map(([lab, v, c]) => {
        const el = add(kp, `<div style="flex:1;padding:16px 18px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)">
          <div style="font:700 15px var(--mono);letter-spacing:.14em;text-transform:uppercase;opacity:.6">${lab}</div><div class="v" style="font:900 34px var(--fig);color:${c};margin-top:4px;white-space:nowrap">R$ 0</div></div>`);
        return { el, v: el.querySelector('.v'), val: v };
      });
      // minigráfico de inadimplência no card "Em aberto"
      this.spark = add(this.kpis[2].el, `<svg viewBox="0 0 160 36" style="width:100%;height:30px;margin-top:4px;display:block"><polyline class="sl" points="0,10 30,12 60,9 90,14 120,11 160,12" fill="none" stroke="#FF8FA3" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
      this.sl = this.spark.querySelector('.sl');
      const ch = this.dash.querySelector('.chart');
      add(ch, `<div style="font:700 15px var(--mono);letter-spacing:.14em;opacity:.55">RECEITA · ÚLTIMOS 6 MESES</div>`);
      this.bars = BARS.map(([m, v], i) => {
        const x = i * ((V ? 840 : 860) / 6);
        add(ch, `<div class="abs" style="left:${x}px;bottom:-4px;width:${(V ? 840 : 860) / 6 - 26}px;text-align:center;font:600 16px var(--fig);opacity:.55">${m}</div>`);
        return add(ch, `<div class="abs" style="left:${x}px;bottom:22px;width:${(V ? 840 : 860) / 6 - 26}px;height:${Math.round(v * 100)}px;border-radius:10px 10px 4px 4px;background:${i === 5 ? 'linear-gradient(180deg,#FF9A5A,#EF4F24)' : 'linear-gradient(180deg,rgba(143,170,255,.75),rgba(95,67,208,.55))'};transform-origin:50% 100%"></div>`);
      });
      const ls = this.dash.querySelector('.list');
      const rows = [['Aurora Estética', 'Parcela 03/12', 1040, 'late'], ['Studio Lume', 'Parcela 05/06', 890, 'paid'], ['Grupo Alfa', 'Parcela 02/10', 2300, 'paid']];
      this.rows = rows.map(([c, p, v, st], i) => {
        const el = add(ls, `<div style="position:absolute;left:0;right:0;top:${i * 80}px;height:68px;border-radius:16px;display:flex;align-items:center;gap:16px;padding:0 18px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);transform-origin:50% 50%">
          <div style="flex:1;min-width:0"><div style="font:700 24px var(--fig);white-space:nowrap">${c}</div><div style="font:500 17px var(--fig);opacity:.55">${p}</div></div>
          <div style="font:800 25px var(--fig);white-space:nowrap">${brl(v)}</div>
          <div class="stt" style="min-width:${V ? 230 : 240}px;text-align:center;padding:8px 12px;border-radius:999px;font:800 17px var(--fig);letter-spacing:.06em"></div></div>`);
        return { el, stt: el.querySelector('.stt'), st };
      });
      this.cap = add(this.dash, `<div class="abs" style="right:30px;bottom:18px;font:700 15px var(--mono);letter-spacing:.14em;color:rgba(159,230,255,.85)">INTEGRAÇÃO · ERP (CONTA AZUL E OUTROS)</div>`);
      // mensagem de cobrança
      this.msg = add(this.stage, `<div class="bub in" style="left:${V ? 110 : 120}px;top:${V ? 540 : 560}px;max-width:${V ? 760 : 740}px;font-size:29px;transform-origin:0 0;box-shadow:0 30px 70px rgba(0,0,0,.5)">
        <div class="who" style="color:#5F43D0">${SR.spark(24)}Agente de IA · WhatsApp</div>Oi, Camila! Sua parcela venceu. Segue o Pix atualizado 👇
        <div style="display:flex;gap:10px;margin-top:12px"><span style="padding:10px 20px;border-radius:999px;background:#18B26B;color:#fff;font:800 23px var(--fig)">Pagar agora</span><span style="padding:10px 18px;border-radius:999px;background:#EEF0F5;color:#2c343c;font:700 21px var(--fig);display:flex;align-items:center;gap:8px">${ICON('pix', '', 'width:22px;height:22px')}Pix copia e cola</span></div>
        <span class="meta">10:30 <span class="rd" style="color:#9aa3b5">✓✓</span></span></div>`);
      this.rd = this.msg.querySelector('.rd');
      this.pix = add(this.stage, `<div class="notif" style="left:${V ? 150 : 160}px;top:-40px;width:${V ? 660 : 640}px;background:linear-gradient(160deg,rgba(24,178,107,.97),rgba(14,130,78,.97))">
        <div style="width:62px;height:62px;border-radius:16px;background:rgba(255,255,255,.2);display:grid;place-items:center;flex:none">${ICON('pix', '', 'width:34px;height:34px')}</div>
        <div class="tx"><div class="t1">Pix recebido<span>agora</span></div><div class="t2">R$ 1.040,00 · Aurora Estética</div></div></div>`);
      this.dashChar = add(root, SR.char('dashboard', 180, `left:${V ? W - 240 : SL + 830}px;top:${V ? ST - 120 : ST - 40}px`));
      cue(31.0, 'whooshDown', { gain: 0.6 });
      cue(31.2, 'blips', { dur: 0.9, gain: 0.45 });
      cue(ALERT, 'alert', { gain: 0.7 }); cue(ALERT + 0.35, 'alert', { gain: 0.5 });
      cue(MSG, 'popIn', { gain: 0.9 }); cue(READ, 'tick', { gain: 0.4, pitch: 7 });
      cue(PIX, 'notif', { gain: 0.9 }); cue(PAID, 'flip', { gain: 0.7 }); cue(PAID + 0.05, 'success', { gain: 0.9 });
    },
    update(t) {
      this.hlA.update(t, 31.08, 33.46);
      this.hlB.update(t, 33.86, 34.6);
      const din = E('outExpo')(clamp((t - 30.98) / 0.6));
      const out = E('in3')(clamp((t - 34.66) / 0.3));
      set(this.dash, { s: 0.6 + 0.4 * din + out * 0.1, o: Math.min(1, din * 1.4) * (1 - out), y: -out * 60 });
      this.dash.style.filter = din < 0.99 ? `blur(${((1 - din) * 12).toFixed(1)}px)` : 'none';
      // indicadores
      this.kpis.forEach((kp, i) => {
        const p = E('out4')(clamp((t - 31.2 - i * 0.1) / 0.75));
        let v = kp.val * p;
        if (i === 2) v = k(t, [31.2, 0], [31.95, 15120, 'out4'], [PAID, 15120], [PAID + 0.5, 14080, 'out3']);
        const tx = 'R$ ' + intBR(v);
        if (kp.v.__v !== tx) { kp.v.textContent = tx; kp.v.__v = tx; }
      });
      const dropP = E('io3')(clamp((t - PAID) / 0.6));
      const ys = [10, 12, 9, 14, 11, 12 + 16 * dropP];
      const pts = ys.map((y, i) => `${i * 32},${y.toFixed(1)}`).join(' ');
      this.sl.setAttribute('points', pts);
      this.sl.setAttribute('stroke', dropP > 0.5 ? '#7CF0B0' : '#FF8FA3');
      // barras
      this.bars.forEach((b, i) => { const p = E('outBackS')(clamp((t - 31.35 - i * 0.07) / 0.55)); b.style.transform = `scaleY(${p.toFixed(3)})`; });
      // linhas da lista
      this.rows.forEach((r, i) => {
        const p = E('outExpo')(clamp((t - 31.75 - i * 0.08) / 0.5));
        const late = r.st === 'late' && t < PAID + 0.15;
        const flip = r.st === 'late' ? clamp((t - PAID) / 0.3) : 0;
        set(r.el, { x: (1 - p) * 120, o: p, p: 1200, rx: flip > 0 && flip < 1 ? Math.sin(flip * Math.PI) * 70 : 0 });
        const html = late ? 'VENCIDA · 3 DIAS' : 'PAGA ✓';
        if (r.stt.__v !== html) { r.stt.textContent = html; r.stt.__v = html; }
        r.stt.style.background = late ? 'rgba(255,61,96,.18)' : 'rgba(24,178,107,.2)';
        r.stt.style.color = late ? '#FF8FA3' : '#7CF0B0';
        r.stt.style.border = late ? '1px solid rgba(255,61,96,.6)' : '1px solid rgba(24,178,107,.5)';
        if (r.st === 'late') {
          const pulse = t > ALERT && t < PAID ? 0.5 + 0.5 * Math.sin((t - ALERT) * 12) : 0;
          r.el.style.boxShadow = late ? `0 0 0 2px rgba(255,61,96,${(0.4 + pulse * 0.5).toFixed(2)}), 0 0 ${(20 + pulse * 30).toFixed(0)}px rgba(255,61,96,${(0.25 + pulse * 0.35).toFixed(2)})` : `0 0 0 2px rgba(24,178,107,.6), 0 0 30px rgba(24,178,107,${(0.5 * Math.max(0, 1 - (t - PAID) * 1.5)).toFixed(2)})`;
          r.el.style.background = late ? 'rgba(255,61,96,.08)' : 'rgba(24,178,107,.1)';
        }
      });
      // mensagem de cobrança e Pix recebido
      const mp = spr(t - MSG, 2.6, 0.55);
      set(this.msg, { s: t < MSG ? 0.5 : 0.5 + 0.5 * mp, o: t < MSG ? 0 : Math.min(1, (t - MSG) * 7) * (1 - E('in3')(clamp((t - 34.0) / 0.3))), y: (t > 34.0 ? E('in3')(clamp((t - 34.0) / 0.3)) * 40 : 0) });
      this.rd.style.color = t >= READ ? '#3FA2FF' : '#9aa3b5';
      const pp = spr(t - PIX, 2.4, 0.5);
      set(this.pix, { y: t < PIX ? -200 : (1 - pp) * -160, o: t < PIX ? 0 : Math.min(1, (t - PIX) * 6) * (1 - out), s: t < PIX ? 1 : 1 });
      SR.cameo(this.dashChar, t, 31.15, 32.15, { r: 8, dy: -60 });
    },
  });
})();
