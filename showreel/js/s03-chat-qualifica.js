// Cenas 3+4 · Atende sozinha (5–9s) e Qualifica sozinha (9–11s).
// Chat no celular do cliente; trechos da conversa viram dados na ficha de qualificação.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, cue, Z } = SR;
  const SL = Z.stage.cx - Z.stage.w / 2, ST = Z.stage.cy - Z.stage.h / 2; // canto do palco no quadro
  const PW = 780, PH = 900, PX = 90, PY = 10; // painel do chat dentro do palco
  const HDR = 112, BODY = PH - HDR;

  SR.chatAvatar = () => ({ x: SL + PX + 100, y: ST + PY + 56, size: 72 });

  // linha do tempo das mensagens
  const M = [
    { id: 'm1', side: 'out', t: 5.45, html: 'Oi! Vocês atendem hoje ainda?', meta: '23:47' },
    { id: 'm2', side: 'in', t: 6.05, typing: 5.72, html: 'Boa noite, Camila! 👋 Atendo sim. Me conta o que você precisa?', meta: '23:47' },
    { id: 'm3', side: 'out', t: 6.6, audio: true, meta: '23:48' },
    { id: 'm4', side: 'in', t: 7.72, typing: 7.46, html: 'Entendi! Dá pra resolver. Você decide sozinha ou com sócio?', meta: '23:48' },
    { id: 'm5', side: 'out', t: 8.22, html: 'Com <span class="hlt" data-k="dec">meu sócio</span>. Queremos começar <span class="hlt" data-k="pra">este mês</span>.', meta: '23:48' },
  ];
  const TRANS = [['Perco muito cliente', 'dor'], ' no WhatsApp. Somos ', ['8 vendedores', 'tam'], '.'];

  const ROWS = [
    { k: 'dor', ico: 'alert', lab: 'Dor', val: 'Perde clientes no WhatsApp', tok: 'Perco muito cliente' },
    { k: 'tam', ico: 'user', lab: 'Tamanho', val: '8 vendedores', tok: '8 vendedores' },
    { k: 'dec', ico: 'checkCircle', lab: 'Decisor', val: 'Camila + sócio', tok: 'meu sócio' },
    { k: 'pra', ico: 'clock', lab: 'Prazo', val: 'Começar este mês', tok: 'este mês' },
  ];
  const TOK_T = 9.12, TOK_GAP = 0.15, TOK_FLY = 0.5;

  SR.scene({
    id: 's03', start: 4.95, end: 11.2,
    build(root) {
      this.hl = SR.Headline(root, [['Responde'], [{ t: 'na hora.', c: 'ai' }]]);
      this.hl2 = SR.Headline(root, [['Qualifica'], [{ t: 'sozinha.', c: 'em' }]]);
      // chips de capacidade
      const chips = [['24/7', 'clock'], ['áudio', 'mic'], ['imagem', 'file'], ['PDF', 'file']];
      const cy = V ? 548 : 300 + 2 * 112 * 0.98 + 54;
      const cx0 = V ? 0 : Z.hl.left;
      this.chips = add(root, `<div class="abs" style="top:${cy}px;${V ? 'left:0;right:0;justify-content:center;' : `left:${cx0}px;`}display:flex;gap:14px"></div>`);
      this.chipEls = chips.map(([txt, ic]) => add(this.chips, `<div class="chipx" style="position:relative;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.28);color:#fff;font-size:26px">${ICON(ic, '', 'width:26px;height:26px;color:#9FE6FF')}${txt}</div>`));

      this.stage = SR.Stage(root);
      this.wrap = add(this.stage, `<div class="abs" style="left:${PX}px;top:${PY}px;width:${PW}px;height:${PH}px;transform-origin:50% 40%"></div>`);
      this.panel = add(this.wrap, `<div class="panel" style="inset:0;border-radius:40px;background:#EDEFF6"></div>`);
      const hd = add(this.panel, `<div class="abs" style="left:0;top:0;right:0;height:${HDR}px;background:#fff;border-bottom:1px solid #e3e5ee;display:flex;align-items:center;gap:18px;padding:0 26px">
          <svg viewBox="0 0 24 24" style="width:30px;height:30px;color:#4C8BF7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><polyline points="15 4 7 12 15 20"/></svg>
          <div class="av-slot" style="width:72px;height:72px;flex:none"></div>
          <div style="flex:1"><div style="font:800 31px var(--fig);color:#1b1f2a">Sua Empresa</div><div class="st" style="font:500 23px var(--fig);color:#18B26B">online</div></div>
          <div style="position:relative;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#F2EEFF;font:700 20px var(--fig);color:#5F43D0">${SR.spark(26)}IA ativa</div>
        </div>`);
      this.avatar = add(hd.querySelector('.av-slot'), SR.spark(72, 'box-shadow:0 0 0 4px #fff, 0 0 26px rgba(123,92,255,.55)'));
      this.status = hd.querySelector('.st');
      this.body = add(this.panel, `<div class="abs" style="left:0;right:0;top:${HDR}px;bottom:0;overflow:hidden;
        background-image:radial-gradient(rgba(95,67,208,.07) 2px, transparent 2.5px);background-size:34px 34px"></div>`);
      this.list = add(this.body, `<div class="abs" style="left:0;right:0;top:0"></div>`);
      this.msgs = M.map(m => {
        let inner;
        if (m.audio) {
          const bars = Array.from({ length: 30 }, (_, i) => `<i style="display:block;width:6px;border-radius:3px;background:#2E8B57;height:${10 + Math.round(Math.abs(Math.sin(i * 1.7) * 26 + Math.sin(i * 0.6) * 14))}px"></i>`).join('');
          inner = `<div style="display:flex;align-items:center;gap:16px">
              <div style="width:58px;height:58px;border-radius:50%;background:#2E8B57;color:#fff;display:grid;place-items:center">${ICON('play', '', 'width:26px;height:26px;margin-left:4px')}</div>
              <div class="wave" style="display:flex;align-items:center;gap:5px;height:60px">${bars}</div>
              <span style="font:600 22px var(--fig);color:#3c6e52">0:12</span></div>
            <div class="tr" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,0,0,.08);font:italic 400 27px/1.3 var(--ui);color:#2a3a30">
              <div style="font:700 17px var(--fig);letter-spacing:.06em;text-transform:uppercase;color:#5F43D0;margin-bottom:4px;display:flex;align-items:center;gap:6px">${SR.spark(22)}transcrito pela IA</div>
              ${TRANS.map(w => (Array.isArray(w) ? `<span class="tw hlt" data-k="${w[1]}">${w[0]}</span>` : w.split(' ').map(x => x ? `<span class="tw">${x}</span>` : '').join(' '))).join('')}</div>`;
        } else inner = `<div>${m.html}</div>`;
        const isOut = m.side === 'out';
        const el = add(this.list, `<div class="bub ${isOut ? 'out' : 'in'}" style="${isOut ? 'right:26px;background:#D9FDD3;color:#1d2b22' : 'left:26px'};max-width:560px;transform-origin:${isOut ? '100%' : '0%'} 100%">
            ${inner}<span class="meta">${m.meta}${isOut ? ' <span style="color:#3FA2FF">✓✓</span>' : ''}</span></div>`);
        return Object.assign({ el }, m);
      });
      this.typing = add(this.list, `<div class="bub in" style="left:26px;padding:22px 26px;display:flex;gap:9px">${[0, 1, 2].map(() => '<i style="display:block;width:13px;height:13px;border-radius:50%;background:#9aa3b5"></i>').join('')}</div>`);
      this.dots = [...this.typing.querySelectorAll('i')];
      this.pill = add(this.stage, SR.pill('<span class="pt">Agente de IA está digitando…</span>', `left:50%;top:${PY + PH - 48}px;transform-origin:50% 50%`));
      this.pillTxt = this.pill.querySelector('.pt');
      this.mic = add(root, SR.char('microphone', 190, `left:${V ? W - 250 : SL + PX + PW - 30}px;top:${V ? ST + 330 : ST + 300}px`));

      // ficha de qualificação
      this.card = add(this.stage, `<div class="panel" style="left:50px;top:300px;width:860px;height:600px;border-radius:30px">
        <div style="display:flex;align-items:center;gap:14px;padding:26px 30px 10px">${SR.spark(46)}<div style="font:800 32px var(--fig);color:#1b1f2a">Qualificação automática</div></div>
        <div class="rows" style="position:absolute;left:30px;top:104px;width:540px"></div>
        <div class="gauge abs" style="left:590px;top:120px;width:240px;height:240px"></div>
        <div class="glab abs" style="left:560px;top:372px;width:300px;text-align:center;font:900 30px var(--fig);color:#C63F18;letter-spacing:.02em">LEAD QUENTE 🔥</div>
        <div class="tags abs" style="left:30px;bottom:28px;right:30px;display:flex;gap:10px"></div></div>`);
      const rows = this.card.querySelector('.rows');
      this.rows = ROWS.map((r, i) => {
        const el = add(rows, `<div style="position:absolute;left:0;top:${i * 96}px;width:540px;height:84px;display:flex;align-items:center;gap:16px;border-bottom:1px solid #eef0f5">
          <div style="width:54px;height:54px;border-radius:16px;background:#F0EDFF;color:#5F43D0;display:grid;place-items:center">${ICON(r.ico, '', 'width:28px;height:28px')}</div>
          <div style="flex:1;min-width:0"><div style="font:700 17px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#8E959C">${r.lab}</div>
          <div class="val" style="font:700 27px var(--ui);color:#1f2329;white-space:nowrap">${r.val}</div></div>
          <svg class="ck" viewBox="0 0 40 40" style="width:44px;height:44px;flex:none"><circle cx="20" cy="20" r="18" fill="#18B26B"/><polyline points="11.5 20.5 17.5 26.5 29 14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30" stroke-dashoffset="30"/></svg></div>`);
        return { el, val: el.querySelector('.val'), ck: el.querySelector('.ck'), poly: el.querySelector('polyline') };
      });
      const g = this.card.querySelector('.gauge');
      g.innerHTML = `<svg viewBox="0 0 240 240" style="width:240px;height:240px;transform:rotate(-90deg)"><defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF9A5A"/><stop offset="1" stop-color="#EF4F24"/></linearGradient></defs>
        <circle cx="120" cy="120" r="100" fill="none" stroke="#F1EEF8" stroke-width="22"/>
        <circle class="arc" cx="120" cy="120" r="100" fill="none" stroke="url(#gg)" stroke-width="22" stroke-linecap="round" stroke-dasharray="628.3" stroke-dashoffset="628.3"/></svg>
        <div class="abs c" style="inset:0;flex-direction:column"><div class="num" style="font:900 84px/1 var(--fig);color:#1b1f2a;letter-spacing:-.04em">0</div><div style="font:700 18px var(--mono);letter-spacing:.14em;color:#8E959C">SCORE</div></div>`;
      this.arc = g.querySelector('.arc'); this.num = g.querySelector('.num'); this.glab = this.card.querySelector('.glab');
      const tg = this.card.querySelector('.tags');
      this.tags = [['lead-quente', 'h'], ['8-vendedores', ''], ['decisor-sócio', ''], ['ia-qualificou', 'g']].map(([t, c]) => add(tg, `<span class="tag ${c}" style="font-size:20px;padding:4px 12px">${t}</span>`));
      this.check = add(root, SR.char('checkmark', 210, `left:${SL + 700}px;top:${ST + 160}px`));

      // fichas voadoras (trechos destacados)
      this.toks = ROWS.map(r => add(root, `<div class="abs tok" style="left:0;top:0;padding:4px 14px;border-radius:10px;background:linear-gradient(90deg,#E6F76A,#6FF0D2);color:#0E0142;font:700 30px var(--ui);white-space:nowrap;box-shadow:0 12px 30px rgba(0,0,0,.35);transform-origin:50% 50%;opacity:0">${r.tok}</div>`));

      // sons
      M.forEach(m => cue(m.t, m.side === 'out' ? 'popOut' : 'popIn', { gain: 0.8 }));
      cue(5.72, 'typing', { dur: 0.33, gain: 0.5 }); cue(7.46, 'typing', { dur: 0.26, gain: 0.5 });
      cue(6.62, 'voice', { dur: 0.7, gain: 0.45 });
      cue(8.78, 'swipe', { gain: 0.5 }); cue(8.9, 'swipe', { gain: 0.45, pitch: 2 });
      ROWS.forEach((r, i) => { cue(TOK_T + i * TOK_GAP, 'whooshS', { gain: 0.5 }); cue(TOK_T + i * TOK_GAP + TOK_FLY, 'tick', { gain: 0.8, pitch: i * 2 }); });
      cue(9.85, 'riseTone', { dur: 0.65, gain: 0.5 }); cue(10.5, 'ding', { gain: 0.8 });
      cue(10.75, 'morph', { gain: 0.6 });
    },
    ready() {
      // posições verticais das mensagens já com as fontes carregadas
      let y = 26;
      this.msgs.forEach(m => { m.y = y; m.h = m.el.offsetHeight; m.el.style.top = y + 'px'; y += m.h + 18; });
      this.typH = this.typing.offsetHeight;
      this.hlts = {};
      this.list.querySelectorAll('.hlt').forEach(s => { this.hlts[s.dataset.k] = s; });
      this.twords = [...this.list.querySelectorAll('.tw')];
    },
    update(t) {
      // títulos
      this.hl.update(t, 5.32, 8.72);
      this.hl2.update(t, 9.02, 10.78);
      // chips
      this.chipEls.forEach((c, i) => {
        const p = spr(t - 6.3 - i * 0.08, 2.6, 0.5), o = clamp((t - 8.66 - i * 0.03) / 0.18);
        set(c, { s: Math.max(0, p) * (1 - E('in3')(o)), o: t < 6.3 ? 0 : 1 - o });
      });
      // painel do chat: entra com a faísca, recua na qualificação
      const pin = E('outExpo')(clamp((t - 5.15) / 0.55));
      const rec = E('io3')(clamp((t - 9.02) / 0.45));
      const gone = E('in3')(clamp((t - 10.6) / 0.35));
      set(this.wrap, { p: 2000, rx: (1 - pin) * 14 + rec * 6, ry: (1 - pin) * -10 + wob(t * 0.6, 2) * 2.2, s: (0.8 + 0.2 * pin) * (1 - rec * 0.14), y: (1 - pin) * 60 - rec * 150, o: Math.min(1, pin * 1.6) * (1 - gone) });
      this.panel.style.filter = rec > 0.01 ? `brightness(${1 - rec * 0.45}) blur(${(rec * 2.5).toFixed(2)}px)` : 'none';
      set(this.avatar, { o: t < 5.55 ? 0 : 1, s: 1 + Math.exp(-(t - 5.55) * 9) * 0.25 * (t >= 5.55 ? 1 : 0) });
      const typingNow = (t > 5.72 && t < 6.05) || (t > 7.46 && t < 7.72);
      const stTxt = typingNow ? 'digitando…' : 'online';
      if (this.status.__v !== stTxt) { this.status.textContent = stTxt; this.status.__v = stTxt; }

      // mensagens
      let bottom = 0;
      this.msgs.forEach(m => {
        const p = spr(t - m.t, 2.8, 0.55);
        const vis = t >= m.t;
        set(m.el, { o: vis ? Math.min(1, (t - m.t) * 8) : 0, s: vis ? 0.6 + 0.4 * p : 0.6, y: vis ? (1 - p) * 26 : 26 });
        if (vis) bottom = m.y + m.h;
      });
      // indicador de digitação
      let tyY = -999, tyO = 0;
      for (const m of this.msgs) if (m.typing && t >= m.typing && t < m.t) { tyY = m.y; tyO = Math.min(1, (t - m.typing) * 8); bottom = Math.max(bottom, m.y + this.typH); }
      set(this.typing, { o: tyO, y: 0 });
      this.typing.style.top = tyY + 'px';
      this.dots.forEach((d, i) => set(d, { y: -Math.max(0, Math.sin((t * 9) - i * 0.9)) * 9 }));
      // rolagem suave
      const target = Math.max(0, bottom + 26 - BODY + 60);
      this.scroll = this.scroll === undefined ? 0 : this.scroll;
      const sc = clamp(target, 0, 2000);
      // rolagem determinística: interpola a partir do alvo anterior
      const msgT = this.msgs.filter(m => t >= m.t).map(m => m.t);
      const lastT = msgT.length ? msgT[msgT.length - 1] : 0;
      const prevBottom = (() => { const vis = this.msgs.filter(m => m.t < lastT); return vis.length ? vis[vis.length - 1].y + vis[vis.length - 1].h : 0; })();
      const prevTarget = Math.max(0, prevBottom + 26 - BODY + 60);
      const sp = E('out3')(clamp((t - lastT) / 0.35));
      set(this.list, { y: -(prevTarget + (sc - prevTarget) * sp) });

      // onda do áudio
      const m3 = this.msgs[2];
      const bars = m3.el.querySelectorAll('.wave i');
      const prog = clamp((t - 6.68) / 0.7);
      bars.forEach((b, i) => {
        const on = i / bars.length < prog;
        b.style.background = on ? '#1f6b44' : '#8fc7a6';
        b.style.transform = `scaleY(${on && prog < 1 ? 0.75 + Math.abs(Math.sin(t * 22 + i)) * 0.5 : 1})`;
      });
      // transcrição palavra a palavra
      this.twords.forEach((w, i) => { const p = clamp((t - 7.04 - i * 0.035) / 0.12); w.style.opacity = p.toFixed(2); });
      // destaques
      const order = ['dor', 'tam', 'dec', 'pra'];
      order.forEach((key, i) => {
        const s = this.hlts[key]; if (!s) return;
        const p = E('out3')(clamp((t - 8.76 - i * 0.07) / 0.3));
        s.style.backgroundImage = 'linear-gradient(90deg, rgba(230,247,106,.95), rgba(111,240,210,.95))';
        s.style.backgroundRepeat = 'no-repeat';
        s.style.backgroundSize = `${(p * 100).toFixed(1)}% 100%`;
        s.style.borderRadius = '6px';
        s.style.boxShadow = p > 0 ? `0 0 0 3px rgba(230,247,106,${(0.5 * p).toFixed(2)})` : 'none';
      });

      // pílula da IA
      const pp = spr(t - 5.72, 2.5, 0.55), po = clamp((t - 8.7) / 0.25);
      const ptxt = t < 7.05 ? 'Agente de IA está digitando…' : t < 7.46 ? 'Agente de IA transcreveu o áudio' : 'Agente de IA está digitando…';
      if (this.pillTxt.__v !== ptxt) { this.pillTxt.textContent = ptxt; this.pillTxt.__v = ptxt; }
      set(this.pill, { x: -this.pill.offsetWidth / 2, s: t < 5.72 ? 0 : Math.max(0, pp) * (1 - E('in3')(po)), o: t < 5.72 ? 0 : 1 - po });
      this.pill.style.boxShadow = `0 0 0 3px hsl(${(250 + Math.sin(t * 3) * 25).toFixed(0)},90%,65%), 0 0 ${30 + Math.sin(t * 5) * 8}px rgba(63,208,255,.65), 0 18px 40px rgba(0,0,0,.35)`;

      SR.cameo(this.mic, t, 6.62, 7.55, { r: 12, dx: 120, dy: 40 });

      // ficha de qualificação
      const cin = E('outExpo')(clamp((t - 9.08) / 0.55));
      const cMorph = E('io4')(clamp((t - 10.62) / 0.3));
      set(this.card, { y: (1 - cin) * 420, s: 0.9 + 0.1 * cin, o: t < 9.08 ? 0 : Math.min(1, cin * 2) * (1 - clamp((t - 10.93) / 0.04)) });
      // recorte encolhendo para o tamanho do card do funil (morph)
      if (cMorph > 0) {
        const tw_ = 588, th_ = 214; // card do funil na escala 1,4
        const cxS = 480, cyS = 460; // centro do palco
        // posição do card dentro do palco: left 50, top 300 (860x600). Alvo: centro do palco
        const L = 50, T = 300;
        const tl = cxS - tw_ / 2 - L, tt = cyS - th_ / 2 - T;
        const il = tl * cMorph, it = tt * cMorph, ir = (860 - tl - tw_) * cMorph, ib = (600 - tt - th_) * cMorph;
        this.card.style.clipPath = `inset(${it.toFixed(1)}px ${ir.toFixed(1)}px ${ib.toFixed(1)}px ${il.toFixed(1)}px round ${(30 - 16 * cMorph).toFixed(1)}px)`;
        [...this.card.children].forEach(ch => { ch.style.opacity = (1 - clamp(cMorph * 2.2)).toFixed(2); });
      } else { this.card.style.clipPath = 'none'; [...this.card.children].forEach(ch => { ch.style.opacity = ''; }); }

      this.rows.forEach((r, i) => {
        const arr = TOK_T + i * TOK_GAP + TOK_FLY;
        const pv = clamp((t - arr + 0.05) / 0.2);
        r.val.style.opacity = pv.toFixed(2);
        const pc = clamp((t - arr) / 0.25);
        r.poly.setAttribute('stroke-dashoffset', (30 * (1 - E('out3')(pc))).toFixed(2));
        set(r.ck, { s: t < arr ? 0 : spr(t - arr, 3, 0.45) });
      });
      const gp = E('io3')(clamp((t - 9.85) / 0.65));
      this.arc.setAttribute('stroke-dashoffset', (628.3 * (1 - 0.92 * gp)).toFixed(1));
      const nv = String(Math.round(92 * gp));
      if (this.num.__v !== nv) { this.num.textContent = nv; this.num.__v = nv; }
      set(this.glab, { s: t < 10.45 ? 0 : spr(t - 10.45, 2.6, 0.45), o: t < 10.45 ? 0 : 1 });
      this.tags.forEach((tg, i) => set(tg, { s: t < 10.5 + i * 0.06 ? 0 : spr(t - 10.5 - i * 0.06, 3, 0.5), o: t < 10.5 + i * 0.06 ? 0 : 1 }));
      SR.cameo(this.check, t, 10.28, 10.75, { r: -8, dy: 60, dx: 60 });

      // fichas voando dos trechos destacados até a ficha
      ROWS.forEach((r, i) => {
        const tok = this.toks[i];
        const t0 = TOK_T + i * TOK_GAP;
        if (t < t0 - 0.12 || t > t0 + TOK_FLY + 0.1) { tok.style.opacity = 0; return; }
        const src = this.hlts[r.k].getBoundingClientRect();
        const dst = this.rows[i].val.getBoundingClientRect();
        const p = E('io3')(clamp((t - t0) / TOK_FLY));
        const lift = E('out3')(clamp((t - (t0 - 0.12)) / 0.12));
        const sx = src.left + src.width / 2, sy = src.top + src.height / 2;
        const dx = dst.left + Math.min(dst.width, tok.offsetWidth * 0.8) / 2, dy = dst.top + dst.height / 2;
        const [x, y] = SR.bez([sx, sy], [(sx + dx) / 2 + (V ? 160 : -160), Math.min(sy, dy) - 160], [dx, dy], p);
        const sc = (1 + lift * 0.18) * (1 - p * 0.22);
        set(tok, { x: x - tok.offsetWidth / 2, y: y - tok.offsetHeight / 2, s: sc, r: Math.sin(p * Math.PI) * (i % 2 ? 8 : -8), o: p >= 1 ? 1 - clamp((t - t0 - TOK_FLY) / 0.1) : 1 });
      });
    },
  });
})();
