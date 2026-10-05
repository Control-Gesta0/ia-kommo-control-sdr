// Cena 5 · O funil anda sozinho (11–15s). Quadro do Kommo recriado (colunas do funil SDR do cliente),
// câmera 2.5D, o card da Camila muda de etapa e o quadro inteiro entra em coreografia.
(function () {
  const { V, W, H, add, set, k, tw, spr, clamp, E, wob, cue, Z, rng } = SR;
  const SX = Z.stage.cx, SY = Z.stage.cy;
  const COLW = 478, X0 = 112, Y0 = 214, SLOT = 168, CW = 430;
  const COLS = [
    ['INICIAL - ENRIQUECIMENTO', '#FFE600', 'Lead novo, IA enriquecendo'],
    ['EM CONTATO', '#99CCFF', 'IA enviou a saudação'],
    ['QUALIFICAÇÃO', '#87F2C0', 'Respondeu e foi qualificado'],
    ['APRESENTAÇÃO AGENDADA', '#99CCFF', 'Reunião marcada pela IA'],
    ['NEGOCIAÇÃO', '#C9B8FF', 'Proposta enviada'],
    ['FECHADO - GANHO', '#4FD18B', 'Contrato e pagamento ok'],
  ];
  const AV = ['linear-gradient(135deg,#FFB38A,#EF4F24)', 'linear-gradient(135deg,#8FD3FF,#4C8BF7)', 'linear-gradient(135deg,#C7B6FF,#7B5CFF)', 'linear-gradient(135deg,#9FF0C8,#18B26B)', 'linear-gradient(135deg,#FFD58A,#F5A623)', 'linear-gradient(135deg,#FFA3B8,#FF3D60)'];
  // cards: [col, slot, nome, empresa, tags]
  const CARDS = [
    [0, 0, 'Rafaela Duarte', 'Clínica Prisma', [['ia-sdr'], ['LEAD Kommo', 'p']]],
    [0, 1, 'Lead Nº 90421', 'Atelier Nobre', [['LEAD Kommo', 'p']]],
    [0, 2, 'Thiago Nunes', 'TN Solar', [['ia-sdr']]],
    [1, 0, 'Camila Rocha', 'Aurora Estética', [['ia-sdr'], ['LEAD Kommo', 'p'], ['lead-quente', 'h']], 'main'],
    [1, 1, 'Henrique Alves', 'HA Engenharia', [['ia-sdr'], ['LEAD Kommo', 'p']]],
    [1, 2, 'Lívia Martins', 'Studio Lume', [['ia-sdr']]],
    [1, 3, 'Otávio Reis', 'Reis Contabilidade', [['ia-sdr'], ['LEAD Kommo', 'p']]],
    [1, 4, 'Patrícia Gomes', 'Doce Ponto', [['ia-sdr']]],
    [2, 0, 'Marcos Vieira', 'Vieira Imóveis', [['ia-sdr'], ['LEAD Kommo', 'p']]],
    [2, 1, 'Sabrina Costa', 'Fit Center', [['ia-sdr']]],
    [2, 2, 'Lead Nº 90377', 'Ótica Visão', [['LEAD Kommo', 'p']]],
    [2, 3, 'Bruno Teles', 'Teles Odonto', [['ia-sdr']]],
    [3, 0, 'Gustavo Prado', 'Prado Advogados', [['ia-finalizou', 'g'], ['LEAD Kommo', 'p']]],
    [3, 1, 'Juliana Freire', 'Bella Pele', [['ia-finalizou', 'g']]],
    [4, 0, 'André Souza', 'Grupo Alfa', [['LEAD Kommo', 'p']]],
    [4, 1, 'Bianca Lopes', 'Nexus Tech', [['ia-finalizou', 'g']]],
    [5, 0, 'Felipe Moura', 'Moura Transportes', [['ganho', 'g']]],
    // novos leads chegando
    [-1, 0, 'Lead Nº 90433', 'Casa Verde', [['LEAD Kommo', 'p']]],
    [-1, 0, 'Diego Martins', 'DM Fitness', [['ia-sdr']]],
    [-1, 0, 'Lead Nº 90436', 'Pet Amigo', [['LEAD Kommo', 'p']]],
  ];
  // eventos: [t, cardIndex, colDestino]  (col -1 → 0 = chegada)
  const EV = [
    [11.58, 3, 2],
    [12.55, 9, 3], [12.7, 0, 1], [12.85, 17, 0], [13.02, 4, 2], [13.18, 12, 4],
    [13.35, 14, 5], [13.5, 1, 1], [13.62, 18, 0], [13.8, 5, 2], [13.95, 13, 4], [14.1, 8, 3],
    [14.22, 19, 0], [14.38, 10, 3], [14.55, 6, 2],
  ];
  const MOVE = 0.56;

  // estado inicial
  function initialState() {
    const st = CARDS.map(c => ({ col: c[0], slot: c[1] }));
    return st;
  }
  // instantâneos depois de cada evento: o card movido vai para o topo da coluna destino
  const snaps = [initialState()];
  EV.forEach(([t, ci, dest]) => {
    const prev = snaps[snaps.length - 1].map(s => Object.assign({}, s));
    const from = prev[ci];
    prev.forEach((s, i) => { if (i !== ci && s.col === from.col && s.slot > from.slot && from.col >= 0) s.slot -= 1; });
    prev.forEach((s, i) => { if (i !== ci && s.col === dest) s.slot += 1; });
    prev[ci] = { col: dest, slot: 0 };
    snaps.push(prev);
  });
  const pos = s => (s.col < 0 ? [X0 + 0 * COLW, Y0 - SLOT * 1.1] : [X0 + s.col * COLW, Y0 + s.slot * SLOT]);

  SR.scene({
    id: 's05', start: 10.86, end: 15.27,
    build(root) {
      this.cam = add(root, `<div class="abs" style="left:0;top:0;width:${X0 + COLS.length * COLW + 40}px;height:1240px;transform-origin:0 0"></div>`);
      const bw = X0 + COLS.length * COLW + 40;
      this.board = add(this.cam, `<div class="panel" style="left:0;top:0;width:${bw}px;height:1240px;border-radius:30px;background:#F5F5F5"></div>`);
      const b = this.board;
      add(b, `<div class="abs" style="left:0;top:0;bottom:0;width:90px;background:#1E2C3B;display:flex;flex-direction:column;align-items:center;gap:26px;padding-top:30px">
        ${['kanban', 'chat', 'calendar', 'chart', 'user', 'db'].map((ic, i) => `<div style="width:46px;height:46px;border-radius:14px;display:grid;place-items:center;color:${i === 0 ? '#fff' : '#8FA3B5'};background:${i === 0 ? 'linear-gradient(135deg,#3FD0FF,#7B5CFF)' : 'transparent'}">${ICON(ic, '', 'width:28px;height:28px')}</div>`).join('')}</div>`);
      this.top = add(b, `<div class="abs" style="left:90px;right:0;top:0;height:84px;background:#fff;border-bottom:1px solid #e6e6e6;display:flex;align-items:center;gap:22px;padding:0 30px;font-family:var(--ui)">
        <b style="font-size:25px;letter-spacing:.08em;color:#2c343c">FUNIL DE VENDAS - SDR</b><span style="font-size:22px;color:#8a9097">⌄</span>
        <span style="background:#CFE3A7;padding:6px 12px;border-radius:4px;font-size:20px;color:#2c3a14">Leads ativos</span><span style="color:#a5abb1;font-size:20px">Pesquisar e filtrar</span>
        <span style="flex:1"></span><span class="sum" style="font-size:22px;color:#6b737b">38 leads: <b class="sumv" style="color:#2c343c">R$ 0,00</b></span>
        <span style="border:1px solid #dfe3e6;border-radius:4px;padding:8px 14px;font:700 18px var(--ui);color:#2c343c;display:flex;gap:6px;align-items:center"><span style="color:#F5A623">${ICON('zap', '', 'width:18px;height:18px')}</span>AUTOMATIZE</span>
        <span style="background:#4C8BF7;color:#fff;border-radius:4px;padding:9px 16px;font:700 18px var(--ui)">+ NOVO LEAD</span></div>`);
      this.sumv = this.top.querySelector('.sumv');
      this.heads = COLS.map((c, i) => add(b, `<div class="abs" style="left:${X0 + i * COLW - 4}px;top:100px;width:${CW + 8}px;text-align:center;font-family:var(--ui)">
        <div style="font:700 20px var(--ui);letter-spacing:.08em;color:#2c343c;white-space:nowrap">${c[0]}</div>
        <div class="cnt" style="font-size:17px;color:#8a9097;margin-top:2px">0 leads: R$0,00</div>
        <div style="height:4px;background:${c[1]};margin-top:10px;border-radius:2px"></div>
        <div style="font-size:16px;color:#8a9097;margin-top:10px;text-align:left;padding-left:6px">${c[2]}</div></div>`));
      this.cnts = this.heads.map(h => h.querySelector('.cnt'));
      this.cards = CARDS.map((c, i) => {
        const main = c[5] === 'main';
        const el = add(b, SR.kcard({ nome: c[2], sub: '', empresa: c[3], ini: c[2].startsWith('Lead') ? '' : c[2].split(' ').map(x => x[0]).slice(0, 2).join(''), avbg: c[2].startsWith('Lead') ? '#d6dbe0' : AV[i % AV.length], tags: c[4], dot: main ? '#EF4F24' : '#F5A623', cls: main ? 'main' : '' }, `left:0;top:0;width:${CW}px;transform-origin:50% 50%`));
        return el;
      });
      this.main = this.cards[3];
      this.mainGlow = add(this.main, `<div class="glow-ai" style="border-radius:16px;inset:-7px;padding:5px;opacity:0"></div>`);
      // sombra do card erguido
      this.shadow = add(b, `<div class="abs" style="left:0;top:0;width:${CW}px;height:150px;border-radius:14px;background:rgba(40,20,120,.35);filter:blur(18px);opacity:0"></div>`);
      this.cam.appendChild(this.main); // card principal fora do quadro: não desfoca no mergulho
      this.pill = add(root, SR.pill('Agente de IA moveu para <b style="margin-left:6px">QUALIFICAÇÃO</b>', 'left:0;top:0;transform-origin:50% 50%'));
      // véu para legibilidade do título
      this.veil = add(root, V
        ? `<div class="abs" style="left:0;right:0;top:0;height:760px;background:linear-gradient(180deg, rgba(10,10,38,.96) 0%, rgba(10,10,38,.85) 45%, rgba(10,10,38,0) 100%)"></div>`
        : `<div class="abs" style="left:0;top:0;bottom:0;width:1000px;background:linear-gradient(90deg, rgba(10,10,38,.96) 0%, rgba(10,10,38,.86) 55%, rgba(10,10,38,0) 100%)"></div>`);
      this.hl = SR.Headline(root, [['O', 'funil', 'anda'], [{ t: 'sozinho.', c: 'grad' }]]);
      this.zap = add(root, SR.char('lightning-pink', 200, 'left:0;top:0'));

      cue(11.0, 'whooshDown', { gain: 0.6 });
      EV.forEach(([t, ci, d], i) => {
        cue(t, 'lift', { gain: i === 0 ? 0.8 : 0.35, pan: (d / 5 - 0.5) });
        cue(t + MOVE * 0.92, 'drop', { gain: i === 0 ? 0.9 : 0.4, pan: (d / 5 - 0.5) });
      });
      cue(12.15, 'chime', { gain: 0.6 });
      cue(13.05, 'zip', { gain: 0.7 });
      cue(14.85, 'whooshIn', { gain: 0.7 });
    },
    update(t) {
      // posição de cada card: estado inicial + soma dos deslocamentos de cada evento (compõe sobreposições)
      const N = CARDS.length;
      const P = snaps[0].map(s => pos(s));
      const lift = new Array(N).fill(0), alpha = new Array(N).fill(1), sc = new Array(N).fill(1);
      CARDS.forEach((c, i) => { if (c[0] < 0) { alpha[i] = 0; } });
      EV.forEach(([te, ci, dest], ei) => {
        const p = E('io3')(clamp((t - te) / MOVE));
        const A = snaps[ei], B = snaps[ei + 1];
        for (let i = 0; i < N; i++) {
          const a = pos(A[i]), b = pos(B[i]);
          if (a[0] !== b[0] || a[1] !== b[1]) { P[i][0] += (b[0] - a[0]) * p; P[i][1] += (b[1] - a[1]) * p; }
        }
        if (t >= te) {
          const q = clamp((t - te) / MOVE);
          lift[ci] = Math.max(lift[ci], Math.sin(q * Math.PI));
          if (A[ci].col < 0) { alpha[ci] = clamp(q * 2.5); sc[ci] = 0.7 + 0.3 * E('outBack')(q); }
        }
      });
      // contadores das colunas
      let si = 0;
      EV.forEach(([te], ei) => { if (t >= te + MOVE * 0.6) si = ei + 1; });
      const counts = [12, 17, 16, 2, 2, 1];
      const base = snaps[0], cur = snaps[si];
      const cc = counts.slice();
      for (let i = 0; i < N; i++) { if (base[i].col >= 0) cc[base[i].col]--; if (cur[i].col >= 0) cc[cur[i].col]++; }
      this.cnts.forEach((el, i) => { const tx = `${cc[i]} leads: R$0,00`; if (el.__v !== tx) { el.textContent = tx; el.__v = tx; } });

      const reveal = clamp((t - 10.98) / 0.3);
      this.cards.forEach((el, i) => {
        const isMain = i === 3;
        const l = lift[i];
        const squash = l > 0 ? 0 : 0;
        set(el, { x: P[i][0], y: P[i][1] - l * 10, s: sc[i] * (1 + l * 0.07), r: l * (i % 2 ? 2.5 : -2.5), o: alpha[i] * (isMain ? clamp((t - 10.86) / 0.08) : reveal) });
        el.style.boxShadow = l > 0.02 ? `0 ${10 + l * 40}px ${26 + l * 50}px rgba(30,16,110,${(0.12 + l * 0.25).toFixed(2)})` : '';
        el.style.zIndex = l > 0.02 ? 5 : 1;
      });
      this.main.style.zIndex = 6;
      // brilho da IA no card principal enquanto é movido
      const gm = k(t, [11.5, 0], [11.7, 1], [12.6, 1], [12.9, 0]);
      set(this.mainGlow, { o: gm });
      this.mainGlow.style.setProperty('--ang', `${(t * 240) % 360}deg`);
      // fundo do quadro aparece
      [...this.board.children].forEach(ch => { if (!this.cards.includes(ch) && ch !== this.shadow) ch.style.opacity = (reveal).toFixed(2); });
      this.board.style.backgroundColor = `rgba(245,245,245,${reveal.toFixed(3)})`;
      this.board.style.boxShadow = `0 50px 110px rgba(5,2,40,${(0.55 * reveal).toFixed(2)})`;

      // câmera: foco num ponto do quadro, levado a um ponto da tela
      const mainP = [P[3][0] + CW / 2, P[3][1] + 75];
      const s = k(t, [10.86, 1.4], [11.0, 1.4], [11.62, V ? 1.02 : 0.86, 'io3'], [12.3, V ? 0.98 : 0.82], [14.6, V ? 0.64 : 0.56, 'io2'], [15.0, 1.25, 'in3'], [15.25, 1.65, 'out2']);
      const rx = k(t, [11.0, 0], [11.62, 18, 'io3'], [14.6, 24, 'io2'], [15.05, 0, 'io3']);
      const rz = k(t, [11.0, 0], [11.62, -6, 'io3'], [14.6, -9, 'io2'], [15.05, 0, 'io3']);
      const fx = k(t, [11.0, mainP[0]], [12.3, mainP[0]], [14.6, X0 + 2.2 * COLW, 'io2'], [15.0, mainP[0], 'io3']);
      const fy = k(t, [11.0, mainP[1]], [12.3, mainP[1]], [14.6, 560, 'io2'], [15.0, mainP[1], 'io3']);
      const fxx = t < 12.3 ? mainP[0] : fx, fyy = t < 12.3 ? mainP[1] : fy;
      const scr = [SX, k(t, [11.0, SY], [11.62, SY + (V ? 30 : 10), 'io3'], [14.6, SY + (V ? 60 : 20)], [15.0, SY, 'io3'])];
      this.cam.style.transform = `translate(${scr[0].toFixed(1)}px,${scr[1].toFixed(1)}px) perspective(2400px) rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${s.toFixed(4)}) translate(${(-fxx).toFixed(1)}px,${(-fyy).toFixed(1)}px)`;
      // mergulho final: o resto desfoca
      const dive = clamp((t - 14.8) / 0.4);
      this.board.style.filter = dive > 0.01 ? `blur(${(dive * 6).toFixed(1)}px) brightness(${1 - dive * 0.35})` : 'none';
      this.board.style.opacity = (1 - E('in2')(clamp((t - 14.95) / 0.3))).toFixed(3);
      set(this.main, { blur: 0 });

      // pílula
      const r = this.main.getBoundingClientRect();
      const pp = spr(t - 12.12, 2.6, 0.5), po = clamp((t - 13.35) / 0.25);
      set(this.pill, { x: r.left + r.width / 2 - this.pill.offsetWidth / 2, y: r.bottom + 26, s: t < 12.12 ? 0 : Math.max(0, pp) * (1 - E('in3')(po)), o: t < 12.12 ? 0 : 1 - po });

      // título e véu
      this.hl.update(t, 11.36, 14.72);
      set(this.veil, { o: k(t, [11.1, 0], [11.5, 1], [14.95, 1], [15.15, 0]) });

      // raio rosa cruzando
      const zp = clamp((t - 13.02) / 0.75);
      const zx = -260 + zp * (W + 520), zy = (V ? 1250 : 640) - Math.sin(zp * Math.PI) * 220;
      set(this.zap, { x: zx, y: zy, r: 18 + Math.sin(t * 20) * 6, s: zp > 0 && zp < 1 ? 1 : 0, o: zp > 0 && zp < 1 ? 1 : 0 });
    },
  });
})();
