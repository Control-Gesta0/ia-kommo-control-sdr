// Camadas globais: fundo vivo, luz vazada, flash, tremida, granulação, vinheta e HUD de showreel.
(function () {
  const { V, W, H, add, set, k, tw, wob, clamp, shake, $ } = SR;
  const flashes = [], leaks = [], shakes = [];
  SR.flashAt = (t, dur = 0.25, color = '#fff', peak = 0.85) => flashes.push({ t, dur, color, peak });
  SR.leakAt = (t, dur = 1.2, colors = ['#EF4F24', '#FF9A5A'], peak = 0.7) => leaks.push({ t, dur, colors, peak });
  SR.shakeAt = (t, dur = 0.4, amp = 14) => shakes.push({ t, dur, amp });

  // Rótulos do HUD por cena
  const LBL = [
    [0, '01', 'o caos'], [3, '02', 'a virada'], [5, '03', 'atendimento'], [9, '04', 'qualificação'],
    [11, '05', 'funil'], [15, '06', 'follow-up'], [17.5, '07', 'agenda'], [21, '08', 'lembretes'],
    [23, '09', 'contrato'], [27, '10', 'pagamento'], [31, '11', 'erp + cobrança'], [35, '12', 'o ciclo'], [37, '13', 'control gestão'],
  ];
  const tc = t => {
    const fr = Math.floor((t % 1) * 30), s = Math.floor(t) % 60, m = Math.floor(t / 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(fr).padStart(2, '0')}`;
  };

  let bg, blobs, gridl, leakEl, leakA, leakB, flashEl, grain, hud, hudTL, hudTR, hudBL, hudBR, ticks, scenesEl;
  SR.global({
    build() {
      bg = $('#bg');
      blobs = ['b1', 'b2', 'b3', 'b4'].map(c => add(bg, `<div class="blob ${c}"></div>`));
      gridl = add(bg, `<div class="gridl"></div>`);
      leakEl = $('#leak');
      leakA = add(leakEl, `<div class="lk"></div>`);
      leakB = add(leakEl, `<div class="lk"></div>`);
      flashEl = $('#flash');
      grain = $('#grain');
      hud = $('#hud');
      scenesEl = $('#scenes');
      const m = V ? { x: 56, top: 92, bot: H - 132 } : { x: 64, top: 52, bot: H - 84 };
      hudTL = add(hud, `<div class="row" style="left:${m.x}px;top:${m.top}px"><span class="rec"></span><span>Control Gestão</span><span class="sep">×</span><span>Kommo</span></div>`);
      hudTR = add(hud, `<div class="row" style="right:${m.x}px;top:${m.top}px"><span class="sep">IA</span><b>auto</b><span class="sep">/</span><span class="scn">01</span></div>`);
      hudBL = add(hud, `<div class="row" style="left:${m.x}px;top:${m.bot}px"><span class="tcv">00:00:00</span></div>`);
      hudBR = add(hud, `<div class="row" style="right:${m.x}px;top:${m.bot}px"><span class="lbl">o caos</span></div>`);
      const tk = 26;
      ticks = [
        add(hud, `<div class="tick" style="left:${tk}px;top:${tk}px;border-width:3px 0 0 3px"></div>`),
        add(hud, `<div class="tick" style="right:${tk}px;top:${tk}px;border-width:3px 3px 0 0"></div>`),
        add(hud, `<div class="tick" style="left:${tk}px;bottom:${tk}px;border-width:0 0 3px 3px"></div>`),
        add(hud, `<div class="tick" style="right:${tk}px;bottom:${tk}px;border-width:0 3px 3px 0"></div>`),
      ];
    },
    update(t) {
      // Fundo: manchas de luz derivando. O laranja cresce no ato do dinheiro, o violeta domina na IA.
      const act3 = k(t, [22, 0], [24, 1, 'io2'], [35, 1], [37, 0.4, 'io2']);
      const ai = k(t, [4.6, 0.25], [5.2, 1, 'out3'], [21, 0.85], [24, 0.5, 'io2'], [35, 0.9], [37, 0.6]);
      const darkOpen = k(t, [0, 0.35], [2.8, 0.6], [3.2, 0.2], [4.9, 0.25], [5.1, 1, 'out2']);
      const pos = [
        [W * 0.85 + wob(t * 0.13, 1) * 160, H * 0.12 + wob(t * 0.11, 2) * 140],
        [W * 0.05 + wob(t * 0.12, 3) * 170, H * 0.95 + wob(t * 0.1, 4) * 150],
        [W * 0.5 + wob(t * 0.09, 5) * 200, H * 0.55 + wob(t * 0.08, 6) * 180],
        [W * 0.2 + wob(t * 0.14, 7) * 160, H * 0.3 + wob(t * 0.12, 8) * 160],
      ];
      const ops = [ai * darkOpen, (0.55 + act3 * 0.6) * darkOpen, 0.9 * darkOpen, ai * 0.8 * darkOpen];
      const SZ = [1500, 1400, 1700, 1100];
      blobs.forEach((b, i) => {
        const sz = SZ[i];
        set(b, { x: pos[i][0] - sz / 2, y: pos[i][1] - sz / 2, s: 1 + wob(t * 0.2, i) * 0.08, o: ops[i] });
      });
      set(gridl, { x: -((t * 18) % 90), y: -((t * 10) % 90), o: k(t, [0, 0], [5, 0], [5.4, 1], [36.5, 1], [37.2, 0.3]) });

      // Luz vazada (transições)
      let lo = 0, lc = null, lt = 0;
      for (const L of leaks) {
        if (t >= L.t && t <= L.t + L.dur) {
          const p = (t - L.t) / L.dur;
          const o = Math.sin(p * Math.PI) * L.peak;
          if (o > lo) { lo = o; lc = L; lt = p; }
        }
      }
      if (lc) {
        set(leakEl, { o: lo });
        const r = Math.max(W, H) * 1.1;
        leakA.style.cssText = `width:${r}px;height:${r}px;left:${-r * 0.4 + lt * W * 0.9}px;top:${H * 0.1 - r / 2}px;background:radial-gradient(closest-side, ${lc.colors[0]}cc, transparent 70%)`;
        leakB.style.cssText = `width:${r * 0.8}px;height:${r * 0.8}px;left:${W - lt * W * 0.8 - r * 0.2}px;top:${H * 0.75 - r * 0.4}px;background:radial-gradient(closest-side, ${lc.colors[1]}aa, transparent 70%)`;
      } else set(leakEl, { o: 0 });

      // Flash
      let fo = 0, fc = '#fff';
      for (const F of flashes) {
        if (t >= F.t && t <= F.t + F.dur) {
          const o = Math.pow(1 - (t - F.t) / F.dur, 2) * F.peak;
          if (o > fo) { fo = o; fc = F.color; }
        }
      }
      flashEl.style.opacity = fo.toFixed(3);
      flashEl.style.background = fc;

      // Tremida global das cenas
      let sx = 0, sy = 0, sr = 0;
      for (const S of shakes) { const q = shake(t, S.t, S.dur, S.amp); sx += q.x; sy += q.y; sr += q.r; }
      scenesEl.style.transform = sx || sy ? `translate3d(${sx.toFixed(2)}px,${sy.toFixed(2)}px,0) rotate(${sr.toFixed(3)}deg)` : '';

      // Granulação viva
      const f = Math.floor(t * 30);
      grain.style.backgroundPosition = `${(f * 73) % 256}px ${(f * 151) % 256}px`;

      // HUD
      const hudO = k(t, [5.0, 0], [5.4, 1, 'out2'], [36.6, 1], [37.0, 0, 'in2']);
      set(hud, { o: hudO });
      let cur = LBL[0];
      for (const l of LBL) if (t >= l[0]) cur = l;
      const scn = hudTR.querySelector('.scn'); if (scn.__v !== cur[1]) { scn.textContent = cur[1]; scn.__v = cur[1]; }
      const lbl = hudBR.querySelector('.lbl'); if (lbl.__v !== cur[2]) { lbl.textContent = cur[2]; lbl.__v = cur[2]; }
      hudBL.querySelector('.tcv').textContent = tc(t);
      const rec = hudTL.querySelector('.rec');
      rec.style.opacity = Math.floor(t * 2) % 2 ? 0.35 : 1;
    },
  });
})();
