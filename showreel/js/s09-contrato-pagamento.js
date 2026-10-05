// Cenas 9+10 · Contrato assinado (23–27s) e pagamento (27–31s). A ficha do lead continua em cena
// entre os dois momentos: primeiro recebe o contrato, depois o valor da venda.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, cue, Z, rng, brl } = SR;
  const SL = Z.stage.cx - Z.stage.w / 2, ST = Z.stage.cy - Z.stage.h / 2;
  const STAMP = 25.0, PDF0 = 25.45, PDF1 = 26.05, FILL = 26.12;
  const PAY0 = 27.0, ODO0 = 27.22, ODO1 = 28.12, FLY0 = 28.3, FLY1 = 28.82, WON = 28.95, FLIP = 29.55, SUM0 = 29.85, SUM1 = 30.6;
  const R = rng(777);
  const confetti = Array.from({ length: 64 }, () => ({ a: -Math.PI / 2 + (R() - 0.5) * 2.4, v: 700 + R() * 900, w: 10 + R() * 12, h: 6 + R() * 8, c: ['#EF4F24', '#FF9A5A', '#E6F76A', '#6FF0D2', '#7B5CFF', '#3FD0FF', '#ffffff'][Math.floor(R() * 7)], spin: (R() - 0.5) * 1400, d: R() * 0.08 }));

  // odômetro de dígitos
  function odometer(parent, text, size, color) {
    const el = add(parent, `<div style="display:flex;align-items:flex-end;font:900 ${size}px/1 var(--fig);letter-spacing:-.03em;color:${color}"></div>`);
    const reels = [];
    [...text].forEach((ch, i) => {
      if (/\d/.test(ch)) {
        const box = add(el, `<span style="display:inline-block;height:1em;overflow:hidden;position:relative"><span class="strip" style="display:flex;flex-direction:column">${Array.from({ length: 30 }, (_, j) => `<span style="height:1em;line-height:1em">${j % 10}</span>`).join('')}</span></span>`);
        reels.push({ strip: box.querySelector('.strip'), d: +ch, idx: reels.length });
      } else add(el, `<span style="display:inline-block;${ch === ' ' ? 'width:.28em' : ''}">${ch === ' ' ? '' : ch}</span>`);
    });
    return {
      el, update(p) {
        reels.forEach((r, i) => {
          const pr = clamp((p - i * 0.035) / (1 - 0.035 * reels.length));
          const total = 20 + r.d; // duas voltas e meia
          const v = E('out4')(pr) * total;
          r.strip.style.transform = `translateY(${(-v).toFixed(3)}em)`;
        });
      },
    };
  }

  SR.scene({
    id: 's09', start: 22.95, end: 31.12,
    build(root) {
      this.hlA = SR.Headline(root, [['Contrato'], [{ t: 'assinado.', c: 'ok' }]]);
      this.hlB = SR.Headline(root, [['Direto'], [{ t: 'no card.', c: 'em' }]]);
      this.hlC = SR.Headline(root, [[{ t: 'Pagou?', c: 'grad' }]]);
      this.hlD = SR.Headline(root, [['O', 'valor', 'cai'], [{ t: 'no card.', c: 'em' }]]);
      this.stage = SR.Stage(root);

      // ---------- documento ----------
      this.doc = add(this.stage, `<div class="panel" style="left:${V ? 150 : 160}px;top:0;width:660px;height:860px;border-radius:20px;padding:46px 50px;transform-origin:50% 50%">
        <div style="display:flex;align-items:center;gap:12px;color:#5F43D0;font:700 18px var(--mono);letter-spacing:.14em">${ICON('contract', '', 'width:26px;height:26px')}DOCUMENTO DIGITAL</div>
        <div style="font:900 34px/1.1 var(--fig);color:#141826;margin-top:16px;letter-spacing:-.01em">Contrato de prestação de serviços</div>
        <div style="font:400 20px var(--ui);color:#6b737b;margin-top:10px">Contratante: <b>Aurora Estética</b> · Contratada: <b>Sua Empresa</b></div>
        ${[['1. Objeto', [92, 80, 64]], ['2. Valor e pagamento', [88, 70]], ['3. Vigência e suporte', [94, 76, 52]]].map(([tt, ls]) => `<div style="margin-top:26px;font:700 22px var(--ui);color:#2c343c">${tt}</div>${ls.map(w => `<div style="height:12px;border-radius:6px;background:#E9EBF1;margin-top:12px;width:${w}%"></div>`).join('')}`).join('')}
        <div style="position:absolute;left:50px;right:50px;bottom:60px">
          <svg class="sig" viewBox="0 0 560 130" style="width:560px;height:130px;display:block;overflow:visible"><text x="16" y="92" style="font:600 92px Caveat;fill:#1C2D7A">Camila Rocha</text></svg>
          <div style="height:2px;background:#9aa2ad;margin-top:-6px"></div>
          <div style="display:flex;justify-content:space-between;font:400 19px var(--ui);color:#6b737b;margin-top:8px"><span>Camila Rocha · Contratante</span><span>05/10/2026</span></div></div></div>`);
      this.sig = this.doc.querySelector('.sig');
      this.pen = add(this.stage, `<div class="abs" style="left:0;top:0;width:64px;height:64px;color:#1C2D7A;opacity:0">${ICON('pen', '', 'width:64px;height:64px')}</div>`);
      this.stamp = add(this.doc, `<div class="abs c" style="left:180px;top:470px;width:420px;height:150px;border:7px solid #18B26B;border-radius:22px;color:#18B26B;transform-origin:50% 50%;flex-direction:column;background:rgba(255,255,255,.55);box-shadow:inset 0 0 0 4px rgba(24,178,107,.25)">
        <div style="display:flex;align-items:center;gap:14px;font:900 58px/1 var(--fig);letter-spacing:.1em">${ICON('check', '', 'width:52px;height:52px')}ASSINADO</div>
        <div style="font:700 16px var(--mono);letter-spacing:.12em;margin-top:8px">ASSINATURA DIGITAL · 05/10 10:12</div></div>`);
      this.ripple = add(this.doc, `<div class="abs" style="left:390px;top:545px;width:10px;height:10px;margin:-5px;border-radius:50%;border:5px solid rgba(24,178,107,.8);opacity:0"></div>`);
      this.capA = add(root, `<div class="abs mono" style="${V ? `left:0;right:0;text-align:center;top:${ST + 880}px` : `left:${Z.hl.left}px;top:${Z.hl.top + 300}px`};font:700 19px var(--mono);letter-spacing:.16em;color:rgba(244,242,255,.7)">INTEGRAÇÃO · ASSINATURA DIGITAL<br><span style="color:#9FE6FF">ZAPSIGN E OUTRAS</span></div>`);
      this.env = add(root, SR.char('envelope', 230, `left:${V ? 30 : SL - 120}px;top:${V ? ST - 40 : ST + 40}px`));

      // ---------- ficha do lead (Kommo) ----------
      this.lead = add(this.stage, `<div class="panel" style="left:${V ? 50 : 40}px;top:${V ? 330 : 330}px;width:${V ? 860 : 880}px;height:590px;border-radius:26px;background:#fff">
        <div style="background:#203D49;color:#fff;padding:24px 30px 0;height:226px;position:relative">
          <div style="display:flex;justify-content:space-between;align-items:center"><div style="font:700 38px var(--ui)">Camila Rocha</div><div style="font:700 30px var(--ui);opacity:.7">⋯</div></div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:8px;font:400 20px var(--ui)"><span style="opacity:.55">#90412</span>
            <span style="border:1.5px solid #E06AAE;background:#3E3550;padding:2px 10px;border-radius:4px">LEAD Kommo</span><span style="border:1px solid rgba(255,255,255,.35);padding:2px 10px;border-radius:4px">ia-sdr</span><span style="border:1px solid rgba(255,255,255,.35);padding:2px 10px;border-radius:4px">reuniao-agendada</span></div>
          <div style="margin-top:14px;font:400 18px var(--ui);opacity:.6">Funil de vendas - SDR</div>
          <div class="stg" style="font:700 25px var(--ui);margin-top:2px;white-space:nowrap">NEGOCIAÇÃO <span style="font-weight:400;opacity:.6">(Hoje)</span></div>
          <div class="bar" style="position:absolute;left:30px;right:30px;bottom:44px;height:6px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden"><div class="bf" style="height:100%;width:72%;background:linear-gradient(90deg,#FFF000 0 18%,#99CCFF 18% 36%,#87F2C0 36% 54%,#99CCFF 54% 72%,#C9B8FF 72% 100%)"></div></div>
          <div style="position:absolute;left:30px;bottom:0;display:flex;gap:28px;font:700 20px var(--ui)"><span style="border-bottom:3px solid #fff;padding-bottom:8px">Principal</span><span style="opacity:.5">Qualificação</span><span style="opacity:.5">IA</span><span style="opacity:.5">Financeiro</span></div></div>
        <div class="fields" style="padding:10px 30px;font-family:var(--ui)"></div></div>`);
      this.stg = this.lead.querySelector('.stg'); this.bf = this.lead.querySelector('.bf');
      const F = [['Usuário responsável', 'Rafael (vendas)'], ['Reunião', '08.10.2026 15:00'], ['Contrato', '<span class="cv" style="color:#a5abb1">…</span>'], ['Venda', '<span class="vv">R$0</span>'], ['Próximo follow-up', '<span style="color:#a5abb1">—</span>']];
      const fl = this.lead.querySelector('.fields');
      this.frows = F.map(([a, b]) => add(fl, `<div style="display:flex;align-items:center;height:68px;border-bottom:1px solid #f0f1f3;position:relative">
        <div style="width:290px;font-size:24px;color:#8E959C">${a}</div><div class="fv" style="font-size:27px;color:#2c343c;position:relative;white-space:nowrap">${b}</div>
        <div class="hlb abs" style="left:280px;right:-10px;top:8px;bottom:8px;border-radius:10px;background:linear-gradient(90deg,rgba(230,247,106,.55),rgba(111,240,210,.55));transform-origin:0 50%;transform:scaleX(0)"></div></div>`));
      this.frows.forEach(r => r.insertBefore(r.querySelector('.hlb'), r.firstChild));
      this.cv = this.lead.querySelector('.cv'); this.vv = this.lead.querySelector('.vv');
      this.chip = add(root, `<div class="abs" style="left:0;top:0;display:flex;align-items:center;gap:12px;padding:14px 22px;border-radius:18px;background:#fff;color:#2c343c;font:700 26px var(--ui);box-shadow:0 18px 40px rgba(0,0,0,.4);opacity:0;white-space:nowrap">
        <span style="width:44px;height:52px;border-radius:8px;background:#FF3D60;color:#fff;display:grid;place-items:center;font:900 13px var(--fig)">PDF</span>contrato-aurora.pdf</div>`);

      // ---------- pagamento ----------
      this.pay = add(this.stage, `<div class="abs" style="left:${V ? 50 : 40}px;top:0;width:${V ? 860 : 880}px;height:300px;transform-origin:50% 100%">
        <div class="pf glass" style="inset:0;border-radius:28px;background:linear-gradient(150deg,rgba(40,36,92,.97),rgba(18,16,52,.97));padding:26px 32px;color:#fff">
          <div style="display:flex;align-items:center;gap:14px;font:800 30px var(--fig)"><span style="width:46px;height:46px;border-radius:50%;background:#18B26B;display:grid;place-items:center">${ICON('check', '', 'width:28px;height:28px')}</span>Pagamento confirmado
            <span style="flex:1"></span><span style="font:700 16px/1.25 var(--mono);letter-spacing:.12em;color:#9FE6FF;text-align:right">INTEGRAÇÃO<br>ASAAS E OUTRAS</span></div>
          <div class="odo" style="margin-top:22px"></div>
          <div style="display:flex;gap:12px;margin-top:18px;font:700 21px var(--fig)">${[['pix', 'Pix'], ['card', 'Cartão'], ['receipt', 'Boleto']].map(([ic, tx]) => `<span style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2)">${ICON(ic, '', 'width:22px;height:22px;color:#6FF0D2')}${tx}</span>`).join('')}</div></div>
        <div class="pb panel" style="inset:0;border-radius:24px;background:#fff;display:flex;align-items:center;gap:20px;padding:0 30px;font-family:var(--ui);transform:rotateX(-90deg);transform-origin:50% 0;backface-visibility:hidden">
          <b style="font-size:27px;letter-spacing:.08em;color:#2c343c">FUNIL DE VENDAS - SDR</b><span style="flex:1"></span>
          <span style="font-size:30px;color:#6b737b">38 leads: <b class="sum" style="color:#11834B">R$ 0,00</b></span></div></div>`);
      this.pf = this.pay.querySelector('.pf'); this.pb = this.pay.querySelector('.pb'); this.sum = this.pay.querySelector('.sum');
      this.odo = odometer(this.pay.querySelector('.odo'), 'R$ 12.480,00', 104, '#ffffff');
      this.capB = add(root, `<div class="abs mono" style="${V ? `left:0;right:0;text-align:center;top:${ST + 940}px` : `left:${Z.hl.left}px;top:${Z.hl.top + 300}px`};font:700 19px var(--mono);letter-spacing:.16em;color:rgba(244,242,255,.7)">INTEGRAÇÃO · PAGAMENTOS<br><span style="color:#9FE6FF">ASAAS E OUTRAS</span></div>`);
      this.money = add(root, `<div class="abs" style="left:0;top:0;padding:6px 18px;border-radius:14px;background:linear-gradient(90deg,#E6F76A,#6FF0D2);color:#0E0142;font:900 40px var(--fig);white-space:nowrap;box-shadow:0 16px 40px rgba(0,0,0,.4);opacity:0">R$ 12.480,00</div>`);
      this.wallet = add(root, SR.char('wallet', 170, `left:${V ? W - 230 : SL + 820}px;top:${V ? ST - 120 : ST - 60}px`));
      this.star = add(root, SR.char('star-white', 200, `left:${V ? 40 : SL - 130}px;top:${V ? ST + 250 : ST + 200}px`));
      this.conf = confetti.map(c => add(root, `<div class="abs" style="left:0;top:0;width:${c.w}px;height:${c.h}px;border-radius:2px;background:${c.c};opacity:0"></div>`));

      // sons
      cue(23.0, 'paper', { gain: 0.7 }); cue(23.85, 'pen', { dur: 1.05, gain: 0.6 });
      cue(STAMP, 'stamp', { gain: 1 }); cue(PDF0, 'whooshS', { gain: 0.6 }); cue(PDF1, 'drop', { gain: 0.7 });
      cue(FILL, 'typing', { dur: 0.5, gain: 0.4 }); cue(FILL + 0.5, 'tick', { gain: 0.7, pitch: 5 });
      cue(PAY0, 'whooshUp', { gain: 0.6 }); cue(ODO0, 'odometer', { dur: ODO1 - ODO0, gain: 0.55 }); cue(ODO1, 'kaching', { gain: 1 });
      cue(FLY0, 'whooshS', { gain: 0.6 }); cue(FLY1, 'drop', { gain: 0.8 }); cue(WON, 'confetti', { gain: 0.9 }); cue(WON, 'success', { gain: 0.8 });
      cue(FLIP, 'flip', { gain: 0.6 }); cue(SUM0, 'odometer', { dur: SUM1 - SUM0, gain: 0.45 }); cue(SUM1, 'ding', { gain: 0.7 });
      cue(30.9, 'whooshIn', { gain: 0.8 });
      SR.shakeAt(STAMP, 0.4, 16); SR.flashAt(STAMP, 0.22, '#d9ffe9', 0.35);
      SR.shakeAt(WON, 0.35, 10); SR.leakAt(WON - 0.1, 1.4, ['#EF4F24', '#E6F76A'], 0.55);
    },
    update(t) {
      this.hlA.update(t, 23.12, 25.02);
      this.hlB.update(t, 25.38, 26.68);
      this.hlC.update(t, 27.05, 28.3);
      this.hlD.update(t, 28.66, 30.86);
      const zoomOut = E('in3')(clamp((t - 30.85) / 0.27));

      // documento entra, assina, carimba e encolhe em PDF
      const din = E('outExpo')(clamp((t - 23.0) / 0.6));
      const dShrink = E('in3')(clamp((t - PDF0) / 0.4));
      set(this.doc, { p: 1800, y: (1 - din) * 500 + Math.sin(t * 0.8) * 6, rx: (1 - din) * 30 + 4, ry: -6 + wob(t * 0.5, 3) * 3, r: (1 - din) * -6, s: (0.92 + 0.08 * din) * (1 - dShrink * 0.88), o: t < 23.0 ? 0 : (1 - clamp((t - PDF0 - 0.3) / 0.1)) });
      const sp = clamp((t - 23.85) / 1.05);
      const spE = E('io2')(sp);
      this.sig.style.clipPath = `inset(0 ${(100 - spE * 100).toFixed(2)}% 0 0)`;
      const sigR = this.sig.getBoundingClientRect(), stR = this.stage.getBoundingClientRect();
      set(this.pen, { x: sigR.left - stR.left + sigR.width * spE - 6, y: sigR.top - stR.top + 20 + Math.sin(sp * 40) * 14 - 44, r: Math.sin(sp * 30) * 6, o: sp > 0 && sp < 1 ? 1 : 0 });
      // carimbo
      const ps = clamp((t - (STAMP - 0.12)) / 0.12);
      const after = t - STAMP;
      set(this.stamp, { s: t < STAMP - 0.12 ? 0 : (2.6 - 1.6 * E('in3')(ps)) * (after > 0 ? 1 + Math.exp(-after * 9) * Math.sin(after * 30) * 0.04 : 1), r: -12, o: t < STAMP - 0.12 ? 0 : Math.min(1, ps * 3) });
      const rp = clamp(after / 0.6);
      set(this.ripple, { s: 1 + E('outExpo')(rp) * 60, o: after > 0 && rp < 1 ? (1 - rp) : 0 });
      // ficha do lead
      const lin = E('outExpo')(clamp((t - 25.62) / 0.5));
      const leadOut = E('in3')(clamp((t - 30.85) / 0.27));
      set(this.lead, { y: (1 - lin) * 600, o: t < 25.62 ? 0 : Math.min(1, lin * 2) * (1 - leadOut), s: 1 + zoomOut * 2.5 });
      this.lead.style.filter = zoomOut > 0.01 ? `blur(${(zoomOut * 10).toFixed(1)}px)` : 'none';
      // chip do PDF voando até o campo Contrato
      if (t >= PDF0 + 0.2 && t < PDF1 + 0.05) {
        const p = E('io3')(clamp((t - PDF0 - 0.2) / (PDF1 - PDF0 - 0.2)));
        const dr = this.doc.getBoundingClientRect();
        const tgt = this.frows[2].querySelector('.fv').getBoundingClientRect();
        const sx = dr.left + dr.width / 2, sy = dr.top + dr.height / 2, dx = tgt.left + 150, dy = tgt.top + tgt.height / 2;
        const [x, y] = SR.bez([sx, sy], [sx + (V ? 260 : 300), Math.min(sy, dy) - 120], [dx, dy], p);
        set(this.chip, { x: x - this.chip.offsetWidth / 2, y: y - this.chip.offsetHeight / 2, s: 1 - p * 0.3, r: Math.sin(p * Math.PI) * 10, o: 1 });
      } else set(this.chip, { o: 0 });
      // preenchimento do campo Contrato
      const fp = clamp((t - FILL) / 0.5);
      const ctxt = '✓ Assinado · contrato-aurora.pdf';
      const cs = t < FILL ? '…' : ctxt.slice(0, Math.round(ctxt.length * fp));
      if (this.cv.__v !== cs) { this.cv.textContent = cs; this.cv.__v = cs; }
      this.cv.style.color = t < FILL ? '#a5abb1' : '#11834B';
      this.cv.style.fontWeight = t < FILL ? 400 : 700;
      const hb = this.frows[2].querySelector('.hlb');
      hb.style.transform = `scaleX(${k(t, [FILL, 0], [FILL + 0.35, 1, 'out3'], [27.0, 1], [27.4, 0, 'in2']).toFixed(3)})`;

      // ---------- pagamento ----------
      const pin = E('outExpo')(clamp((t - PAY0) / 0.55));
      set(this.pay, { y: (1 - pin) * -260, s: 0.9 + 0.1 * pin, o: t < PAY0 ? 0 : Math.min(1, pin * 2) * (1 - leadOut), p: 1600 });
      this.odo.update(clamp((t - ODO0) / (ODO1 - ODO0)));
      // virada do cartão de pagamento para a barra do funil
      const fl = E('io3')(clamp((t - FLIP) / 0.4));
      this.pf.style.transform = `perspective(1400px) rotateX(${(fl * 90).toFixed(2)}deg)`;
      this.pf.style.transformOrigin = '50% 100%';
      this.pf.style.opacity = fl < 0.98 ? 1 : 0;
      this.pb.style.transform = `perspective(1400px) rotateX(${(-90 + fl * 90).toFixed(2)}deg)`;
      this.pb.style.height = '120px';
      this.pb.style.top = '90px';
      const sp2 = E('out4')(clamp((t - SUM0) / (SUM1 - SUM0)));
      const sv = brl(12480 * sp2);
      if (this.sum.__v !== sv) { this.sum.textContent = sv; this.sum.__v = sv; }
      // valor voando até o campo Venda
      if (t >= FLY0 - 0.05 && t < FLY1 + 0.05) {
        const p = E('io3')(clamp((t - FLY0) / (FLY1 - FLY0)));
        const or = this.pay.querySelector('.odo').getBoundingClientRect();
        const tg = this.frows[3].querySelector('.fv').getBoundingClientRect();
        const sx = or.left + 260, sy = or.top + 50, dx = tg.left + 120, dy = tg.top + tg.height / 2;
        const [x, y] = SR.bez([sx, sy], [Math.max(sx, dx) + 120, (sy + dy) / 2], [dx, dy], p);
        set(this.money, { x: x - this.money.offsetWidth / 2, y: y - this.money.offsetHeight / 2, s: 1.1 - p * 0.35, r: Math.sin(p * Math.PI) * -8, o: 1 });
      } else set(this.money, { o: 0 });
      const vtxt = t < FLY1 ? 'R$0' : 'R$ 12.480,00';
      if (this.vv.__v !== vtxt) { this.vv.textContent = vtxt; this.vv.__v = vtxt; }
      this.vv.style.color = t < FLY1 ? '#2c343c' : '#11834B';
      this.vv.style.fontWeight = t < FLY1 ? 400 : 900;
      const hb2 = this.frows[3].querySelector('.hlb');
      hb2.style.transform = `scaleX(${k(t, [FLY1, 0], [FLY1 + 0.3, 1, 'out3'], [30.4, 1], [30.8, 0, 'in2']).toFixed(3)})`;
      // etapa vira FECHADO - GANHO
      const won = t >= WON;
      const stg = won ? 'FECHADO - GANHO <span style="font-weight:400;opacity:.6">(Hoje)</span>' : 'NEGOCIAÇÃO <span style="font-weight:400;opacity:.6">(Hoje)</span>';
      if (this.stg.__v !== stg) { this.stg.innerHTML = stg; this.stg.__v = stg; }
      this.stg.style.color = won ? '#7CF0B0' : '#fff';
      this.bf.style.width = `${(72 + 28 * E('out3')(clamp((t - WON) / 0.4))).toFixed(1)}%`;
      if (won) this.bf.style.background = 'linear-gradient(90deg,#4FD18B,#9DF5C5)';
      else this.bf.style.background = 'linear-gradient(90deg,#FFF000 0 18%,#99CCFF 18% 36%,#87F2C0 36% 54%,#99CCFF 54% 72%,#C9B8FF 72% 100%)';
      // confete
      const lr = this.lead.getBoundingClientRect();
      this.conf.forEach((el, i) => {
        const c = confetti[i], dt = t - WON - c.d;
        if (dt < 0 || dt > 1.6) { el.style.opacity = 0; return; }
        const vx = Math.cos(c.a) * c.v, vy = Math.sin(c.a) * c.v;
        const x = lr.left + lr.width / 2 + vx * dt * Math.exp(-dt * 1.2), y = lr.top + 140 + vy * dt + 900 * dt * dt;
        set(el, { x, y, r: c.spin * dt, sx: Math.cos(dt * 9 + i), o: 1 - clamp((dt - 1.1) / 0.5) });
      });
      // legendas de integração
      set(this.capA, { o: k(t, [23.6, 0], [23.9, 1], [25.3, 1], [25.5, 0]) });
      set(this.capB, { o: 0 });
      // personagens
      SR.cameo(this.env, t, 23.0, 23.95, { r: -10, dx: -120, dy: -40 });
      SR.cameo(this.wallet, t, 27.05, 28.2, { r: 10, dy: -80 });
      SR.cameo(this.star, t, WON, 29.95, { r: -12, dy: 80 });
    },
  });
})();
