"""Trilha original + efeitos sonoros, sintetizados do zero (sem samples de terceiros).

Música: eletrônica a 120 BPM em Lá menor / Dó maior, compasso de 2 s com o primeiro tempo forte em 1,0 s,
para que o drop (5,0 s) e o impacto final (37,0 s) caiam no tempo forte. Progressão Am–F–C–G e cadência G→C no logo.
Efeitos: lidos de cues.json, que as próprias cenas registram (sincronia exata com a animação).

Uso: python3 audio/make_audio.py audio/cues.json out/trilha.wav [out/voz.wav]  (com a voz: versão narrada)
"""
import json
import sys

import numpy as np
from scipy import signal

SR = 48000
DUR = 43.0
N = int(SR * DUR)
RNG = np.random.default_rng(1234)
BPM = 120.0
BEAT = 60.0 / BPM          # 0,5 s
BAR = 4 * BEAT             # 2 s
T_OFF = 1.0                # primeiro tempo forte


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(n):
    return np.arange(n) / SR


def env_exp(n, dec, att=0.002):
    t = tt(n)
    a = np.clip(t / max(att, 1e-4), 0, 1)
    return a * np.exp(-t / dec)


def adsr(n, a, d, s, r, hold=None):
    t = tt(n)
    tot = n / SR
    hold = tot - r if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-4), np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-4), s))
    rel = np.clip((t - hold) / max(r, 1e-4), 0, 1)
    return e * (1 - rel)


def saw(freq, n, phase=0.0):
    """Dente de serra com polyBLEP (menos aliasing)."""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = f / SR
    ph = (phase + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    # polyBLEP
    m1 = ph < dt
    x = ph[m1] / dt[m1]
    y[m1] -= x + x - x * x - 1
    m2 = ph > 1 - dt
    x = (ph[m2] - 1) / dt[m2]
    y[m2] -= x * x + x + x + 1
    return y


def sine(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return np.sin(2 * np.pi * (phase + np.cumsum(f) / SR))


def square(freq, n):
    return np.sign(sine(freq, n)) * 0.8


def noise(n):
    return RNG.standard_normal(n)


def lp(x, fc, order=2):
    fc = min(fc, SR * 0.45)
    return signal.sosfilt(signal.butter(order, fc, 'low', fs=SR, output='sos'), x)


def hp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, 'high', fs=SR, output='sos'), x)


def bp(x, lo, hi, order=2):
    hi = min(hi, SR * 0.45)
    return signal.sosfilt(signal.butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def sweep_filter(x, f_of_t, kind='low', block=256, q_order=2):
    """Filtro com corte variando no tempo (processado em blocos com estado contínuo)."""
    out = np.zeros_like(x)
    zi = None
    for i in range(0, len(x), block):
        tc = i / SR
        fc = float(np.clip(f_of_t(tc), 30, SR * 0.45))
        sos = signal.butter(q_order, fc, kind, fs=SR, output='sos')
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[i:i + block], zi = signal.sosfilt(sos, x[i:i + block], zi=zi)
    return out


def mixa(*xs):
    """Soma sinais mono de comprimentos diferentes (completa com silêncio)."""
    n = max(len(x) for x in xs)
    y = np.zeros(n)
    for x in xs:
        y[:len(x)] += x
    return y


def norm(x, peak=1.0):
    m = np.max(np.abs(x)) + 1e-9
    return x / m * peak


def pan2(x, p):
    p = float(np.clip(p, -1, 1))
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def place(bus, x, t0, gain=1.0):
    """Soma um sinal (mono ou estéreo) no barramento a partir de t0."""
    i = int(round(t0 * SR))
    if x.ndim == 1:
        x = np.stack([x, x])
    if i < 0:
        x = x[:, -i:]
        i = 0
    n = min(x.shape[1], bus.shape[1] - i)
    if n > 0:
        bus[:, i:i + n] += x[:, :n] * gain


def make_ir(dur=2.4, pre=0.02, damp=6000, decay=0.55):
    n = int(SR * dur)
    t = tt(n)
    ir = np.zeros((2, n))
    for c in range(2):
        nz = noise(n) * np.exp(-t / decay)
        nz = lp(nz, damp)
        ir[c] = nz
    k = int(pre * SR)
    ir = np.concatenate([np.zeros((2, k)), ir[:, :n - k]], axis=1)
    return ir / np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True)) * 0.6


IR_BIG = make_ir(2.6, 0.03, 5200, 0.7)
IR_ROOM = make_ir(0.9, 0.008, 7000, 0.18)


def reverb(x2, ir, wet=0.3):
    out = np.zeros((2, x2.shape[1]))
    for c in range(2):
        out[c] = signal.fftconvolve(x2[c], ir[c])[:x2.shape[1]]
    return x2 * (1 - wet * 0.3) + out * wet


# ------------------------------------------------------------ bateria
def kick(n=int(0.45 * SR), f0=150, f1=46, punch=1.0):
    t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.32)
    click = hp(noise(n), 3000) * np.exp(-t / 0.004) * 0.35 * punch
    return np.tanh((body + click) * 1.4) * 0.9


def clap(n=int(0.35 * SR)):
    t = tt(n)
    e = np.zeros(n)
    for d in (0.0, 0.011, 0.022, 0.034):
        e += np.exp(-np.clip(t - d, 0, None) / 0.008) * (t >= d)
    e += np.exp(-t / 0.13) * 0.6
    return bp(noise(n), 900, 3200) * e * 0.55


def hat(open_=False):
    n = int((0.32 if open_ else 0.07) * SR)
    t = tt(n)
    x = hp(noise(n), 7500) + 0.3 * hp(sum(square(f, n) for f in (5600, 7900, 9800, 12400)), 7000)
    return x * np.exp(-t / (0.16 if open_ else 0.022)) * (0.32 if open_ else 0.22)


def snare(n=int(0.25 * SR)):
    t = tt(n)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05) * 0.5
    nz = bp(noise(n), 1200, 7000) * np.exp(-t / 0.11)
    return (tone + nz) * 0.6


def crash(n=int(2.4 * SR)):
    t = tt(n)
    x = hp(noise(n), 3500) * np.exp(-t / 0.9)
    metal = sum(np.sin(2 * np.pi * f * t + RNG.random() * 6) for f in (3170, 4410, 5350, 6620, 8130)) * np.exp(-t / 0.6) * 0.08
    return (x * 0.5 + metal) * 0.6


def sub_boom(n=int(1.6 * SR), f0=58, f1=32):
    t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t / 0.25)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)


# ------------------------------------------------------------ sintetizadores
def supersaw(m, n, voices=5, detune=0.12, cutoff=2400, env=None):
    y = np.zeros(n)
    for v in range(voices):
        d = (v - (voices - 1) / 2) / max(1, (voices - 1) / 2) * detune
        y += saw(midi(m + d), n, RNG.random())
    y /= voices
    y = lp(y, cutoff)
    return y * (env if env is not None else 1)


def pluck(m, dur=0.35, cutoff0=6000, cutoff1=600, bright=1.0):
    n = int(dur * SR)
    t = tt(n)
    y = saw(midi(m), n) * 0.6 + saw(midi(m + 0.08), n) * 0.4
    y = sweep_filter(y, lambda tc: cutoff1 + (cutoff0 * bright - cutoff1) * np.exp(-tc / 0.07), block=128)
    return y * env_exp(n, dur * 0.35, 0.002)


def bell(f, dur=1.2, ratio=3.5, index=2.5):
    n = int(dur * SR)
    t = tt(n)
    mod = np.sin(2 * np.pi * f * ratio * t) * index * np.exp(-t / (dur * 0.3))
    return np.sin(2 * np.pi * f * t + mod) * env_exp(n, dur * 0.35, 0.001)


# ------------------------------------------------------------ música
def build_music():
    mus = np.zeros((2, N))
    drums = np.zeros((2, N))
    bassb = np.zeros((2, N))
    synth = np.zeros((2, N))
    CH = {'Am': [57, 60, 64], 'F': [57, 60, 65], 'C': [55, 60, 64], 'G': [55, 59, 62], 'Gsus': [55, 60, 62]}
    ROOT = {'Am': 33, 'F': 29, 'C': 36, 'G': 31, 'Gsus': 31}
    prog = ['Am', 'F', 'C', 'G']

    def chord_at(bar_idx):
        return prog[bar_idx % 4]

    kicks = []
    # --- intro (0–3 s): drone grave com filtro abrindo + tique de relógio
    n = int(3.3 * SR)
    t = tt(n)
    dr = sum(saw(midi(m), n, RNG.random()) for m in (33, 40, 45)) / 3
    dr = sweep_filter(dr, lambda tc: 180 + 900 * (tc / 3.0) ** 2)
    dr *= np.clip(t / 0.4, 0, 1)
    # tape stop em 3,0 s: o drone cai de altura e some
    stop = np.clip((t - 3.0) / 0.3, 0, 1)
    dr *= (1 - stop) ** 2
    place(synth, pan2(dr * 0.5, 0), 0.0)
    for i in range(int(3.0 / (BEAT / 2))):
        tk = 0.0 + i * BEAT / 2
        if tk < 0.45:
            continue
        place(drums, pan2(hat() * (0.5 if i % 2 else 0.8), 0.25 if i % 2 else -0.25), tk)
    for tb in (1.0, 2.0):  # batidas de coração graves
        place(drums, kick(f0=90, f1=40, punch=0.3) * 0.55, tb)
    # --- break (3–5 s): prato invertido + riser até o drop, silêncio de 1/8 antes
    rc = crash()[::-1][-int(1.75 * SR):]
    place(drums, pan2(rc * 0.9, 0), 5.0 - len(rc) / SR - 0.06)
    n = int(1.7 * SR)
    rs = sweep_filter(noise(n), lambda tc: 400 + 7000 * (tc / 1.7) ** 2, 'low')
    rs *= np.linspace(0, 1, n) ** 2 * 0.35
    place(synth, pan2(rs, 0), 3.25)

    # --- groove (5–21 e 23–35 s)
    def groove_bar(t0, ci, energy, kick_on=True, last=False):
        chord = chord_at(ci)
        notes = CH[chord]
        root = ROOT[chord]
        for b in range(4):
            tb = t0 + b * BEAT
            if kick_on:
                place(drums, kick() * 0.95, tb)
                kicks.append(tb)
            # hats: aberto no contratempo, fechado em semicolcheias
            place(drums, pan2(hat(True) * 0.75, 0.2), tb + BEAT / 2)
            for s in range(4):
                if energy > 0.5 or s % 2 == 0:
                    place(drums, pan2(hat() * (0.55 + 0.25 * (s == 2)), -0.3 + 0.2 * s), tb + s * BEAT / 4)
            if b in (1, 3):
                place(drums, pan2(clap() * 0.9, 0.05), tb)
        # baixo em colcheias (oitava alternada na energia alta)
        for e in range(8):
            te = t0 + e * BEAT / 2
            m = root + 12 + (12 if (energy > 0.5 and e % 2 == 1) else 0)
            nn = int(BEAT / 2 * SR)
            y = saw(midi(m), nn) * 0.7 + sine(midi(m - 12), nn) * 0.6
            y = lp(y, 520 + 380 * energy) * adsr(nn, 0.004, 0.08, 0.6, 0.05)
            place(bassb, pan2(y * 0.55, 0), te)
        # acordes em stabs nos contratempos (pluck)
        for e in range(8):
            if e % 2 == 1 or (energy > 0.5 and e in (0, 3, 6)):
                te = t0 + e * BEAT / 2
                y = sum(pluck(m, 0.32, 5200, 500, 0.7 + 0.5 * energy) for m in notes) / 3
                place(synth, pan2(y * 0.5, -0.15 if e % 4 == 1 else 0.15), te)
        # pad do compasso
        nn = int(BAR * SR)
        pad = sum(supersaw(m - 12, nn, 5, 0.14, 1500 + 900 * energy) for m in notes) / 3
        pad *= adsr(nn, 0.25, 0.3, 0.8, 0.4)
        place(synth, pan2(pad * 0.28, -0.4), t0)
        place(synth, pan2(pad * 0.28, 0.4), t0 + 0.012)
        # melodia/arpejo na energia alta
        if energy > 0.5:
            arp = notes + [notes[1] + 12, notes[2] + 12, notes[0] + 12]
            for s in range(16):
                if s % 4 == 3 and not last:
                    continue
                te = t0 + s * BEAT / 4
                m = arp[(s * 2) % len(arp)] + 12
                y = pluck(m, 0.22, 7000, 1200, 1.2) * 0.35
                place(synth, pan2(y, 0.5 if s % 2 else -0.5), te)
                place(synth, pan2(y * 0.35, -0.5 if s % 2 else 0.5), te + 0.375)  # eco

    bar_i = 0
    for i in range(8):                      # 5–21 s
        groove_bar(5.0 + i * BAR, bar_i, 0.35 if i < 4 else 0.45)
        bar_i += 1
    # 21–23 s: respiro — sem bumbo, rufar subindo
    t0 = 21.0
    chord = chord_at(bar_i)
    nn = int(BAR * SR)
    pad = sum(supersaw(m - 12, nn, 5, 0.14, 1) for m in CH[chord]) / 3
    pad = sweep_filter(sum(supersaw(m - 12, nn, 5, 0.14, 8000) for m in CH[chord]) / 3, lambda tc: 600 + 4000 * (tc / 2) ** 2)
    place(synth, pan2(pad * 0.3 * adsr(nn, 0.05, 0.2, 0.9, 0.05), 0), t0)
    for s in range(16):
        ts_ = t0 + s * BEAT / 4 if s < 8 else t0 + 1.0 + (s - 8) * BEAT / 8
        place(drums, pan2(snare() * (0.25 + 0.04 * s), 0.1), ts_)
    for s in range(8):
        place(drums, pan2(snare() * (0.55 + 0.04 * s), 0.1), t0 + 1.5 + s * BEAT / 8)
    bar_i += 1
    for i in range(6):                      # 23–35 s
        groove_bar(23.0 + i * BAR, bar_i, 0.8, last=(i == 5))
        bar_i += 1
    # 33–35: rufar de construção
    for s in range(16):
        place(drums, pan2(snare() * (0.15 + 0.03 * s), 0), 33.0 + s * BEAT / 4)
    # 35–37: clímax do ciclo — bumbo em todos os tempos, caixa em semicolcheias, Gsus → G pedal
    for s in range(16):
        tb = 35.0 + s * BEAT / 4
        if s % 2 == 0:
            place(drums, kick() * 0.9, tb)
            kicks.append(tb)
        place(drums, pan2(snare() * (0.3 + 0.035 * s), 0), tb)
    for e in range(16):
        te = 35.0 + e * BEAT / 4
        if te > 36.86:
            break
        m = 43 + 12 + (12 if e % 2 else 0)
        nnb = int(BEAT / 4 * SR)
        y = lp(saw(midi(m), nnb), 900) * adsr(nnb, 0.003, 0.05, 0.6, 0.03)
        place(bassb, pan2(y * 0.5, 0), te)
    nn = int(1.86 * SR)
    pad = sum(supersaw(m, nn, 7, 0.16, 9000) for m in CH['Gsus'][:2] + [62, 67]) / 4
    pad = sweep_filter(pad, lambda tc: 800 + 7000 * (tc / 1.86) ** 2)
    place(synth, pan2(pad * 0.32 * adsr(nn, 0.1, 0.2, 1, 0.02), 0), 35.0)
    n = int(1.86 * SR)
    rs = sweep_filter(noise(n), lambda tc: 600 + 11000 * (tc / 1.86) ** 2.5, 'low')
    place(synth, pan2(rs * np.linspace(0, 1, n) ** 2 * 0.4, 0), 35.0)
    # 37 s: resolução em Dó maior (acorde grande) + outro
    nn = int(6.0 * SR)
    big = sum(supersaw(m, nn, 7, 0.18, 5200) for m in (48, 55, 60, 64, 67, 72)) / 6
    big *= adsr(nn, 0.005, 1.2, 0.55, 2.6, hold=3.4)
    place(synth, pan2(big * 0.42, -0.3), 37.0)
    place(synth, pan2(big * 0.42, 0.3), 37.015)
    place(bassb, pan2(lp(saw(midi(36), int(3 * SR)) * 0.6 + sine(midi(24), int(3 * SR)), 300) * adsr(int(3 * SR), 0.005, 0.6, 0.5, 1.4) * 0.6, 0), 37.0)
    # arpejo brilhante do outro (sinos FM)
    arp = [72, 76, 79, 84, 79, 76]
    for s in range(22):
        te = 37.5 + s * BEAT / 2
        if te > 42.4:
            break
        y = bell(midi(arp[s % len(arp)]), 1.0, 2.0, 1.2) * 0.16 * (1 - (te - 37.5) / 6)
        place(synth, pan2(y, 0.6 if s % 2 else -0.6), te)
        place(synth, pan2(y * 0.4, -0.6 if s % 2 else 0.6), te + 0.375)
    # bumbo suave nos tempos fortes do outro
    for tb in (39.0, 41.0):
        place(drums, kick(f0=120, f1=44, punch=0.4) * 0.5, tb)
        kicks.append(tb)

    # sidechain no baixo e nos sintetizadores
    g = np.ones(N)
    tvec = tt(N)
    for tk in kicks:
        i0 = int(tk * SR)
        i1 = min(N, i0 + int(0.35 * SR))
        seg = tvec[i0:i1] - tk
        g[i0:i1] = np.minimum(g[i0:i1], 1 - 0.65 * np.exp(-seg / 0.09))
    bassb *= g
    synth[:, int(5.0 * SR):] *= (0.55 + 0.45 * g[int(5.0 * SR):])

    synth = reverb(synth, IR_BIG, 0.28)
    drums = reverb(drums, IR_ROOM, 0.16)
    mus = drums * 0.9 + bassb * 0.95 + synth * 0.85
    # transições grandes da música
    place(mus, pan2(crash() * 0.7, 0), 5.0)
    place(mus, kick() * 0.9, 5.0)
    place(mus, sub_boom() * 0.75, 5.0)
    place(mus, pan2(crash() * 0.45, 0), 23.0)
    place(mus, pan2(crash() * 0.9, 0), 37.0)
    place(mus, sub_boom(int(2.2 * SR), 60, 30) * 0.9, 37.0)
    return mus


# ------------------------------------------------------------ efeitos
def whoosh(dur=0.45, f0=300, f1=4000, up=True, width=0.6):
    n = int(dur * SR)
    t = tt(n)
    p = t / dur
    curve = (lambda tc: f0 + (f1 - f0) * (tc / dur) ** 1.5) if up else (lambda tc: f1 + (f0 - f1) * (tc / dur) ** 0.7)
    x = sweep_filter(noise(n), curve, 'low')
    x = hp(x, 120)
    e = np.sin(np.pi * np.clip(p, 0, 1)) ** 1.5
    L = x * e * (1 - width * (p - 0.5))
    R = x * e * (1 + width * (p - 0.5))
    return norm(np.stack([L, R]), 0.8)


def sfx(name, o):
    g = o.get('gain', 1.0)
    pitch = o.get('pitch', 0)
    pf = 2 ** (pitch / 12)
    dur = o.get('dur', None)
    if name == 'ping':
        n = int(0.5 * SR)
        y = mixa(bell(1568 * pf, 0.5, 2.0, 0.6), 0.7 * bell(2093 * pf, 0.4, 2.0, 0.5)) * 0.5
        return pan2(y, o.get('pan', 0)) * g * 0.42
    if name in ('hit', 'hitSoft'):
        n = int(0.5 * SR)
        y = kick(n, 110, 48, 1.0) * 0.8 + hp(noise(n), 2500) * env_exp(n, 0.012) * 0.3
        y = reverb(np.stack([y, y]), IR_ROOM, 0.25)
        return y * g * (0.75 if name == 'hit' else 0.5)
    if name == 'glitch':
        n = int(0.42 * SR)
        t = tt(n)
        gate = (np.sin(2 * np.pi * 28 * t) > 0).astype(float)
        crush = np.round(noise(n) * 3) / 3
        tone = square(220 + 400 * (RNG.random(n) > 0.97), n)
        y = (crush * 0.5 + tone * 0.35) * gate * env_exp(n, 0.25)
        return np.stack([y, np.roll(y, 300)]) * g * 0.32
    if name == 'tapestop':
        n = int(0.4 * SR)
        t = tt(n)
        f = 520 * np.exp(-t / 0.12) + 40
        y = lp(saw(f, n), 1200) * (1 - t / 0.4)
        return pan2(y, 0) * g * 0.3
    if name == 'suck':
        d = dur or 1.0
        n = int(d * SR)
        t = tt(n)
        x = sweep_filter(noise(n), lambda tc: 200 + 6000 * (tc / d) ** 2, 'low')
        e = (t / d) ** 2.2
        e[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
        return norm(np.stack([x * e, np.roll(x, 200) * e]), 0.7) * g * 0.8
    if name == 'soft':
        n = int(0.8 * SR)
        x = lp(noise(n), 900) * np.sin(np.pi * np.clip(tt(n) / 0.8, 0, 1)) ** 2
        y = x + 0.3 * sine(midi(69), n) * env_exp(n, 0.4, 0.05)
        return reverb(np.stack([y, y]), IR_BIG, 0.4) * g * 0.35
    if name == 'boom':
        return pan2(sub_boom(int(1.2 * SR), 55, 34), 0) * g * 0.6
    if name in ('impact', 'impactBig'):
        n = int(2.0 * SR)
        y = kick(n, 160, 40, 1.2) * 0.9 + sub_boom(n, 62, 30) * 0.7
        nz = lp(noise(n), 3000) * env_exp(n, 0.25, 0.001) * 0.4
        st = np.stack([y + nz, y + np.roll(nz, 400)])
        st = reverb(st, IR_BIG, 0.35)
        return st * g * (0.85 if name == 'impact' else 1.0)
    if name == 'shimmer':
        n = int(1.4 * SR)
        y = np.zeros(n)
        for i in range(10):
            f = midi(84 + RNG.integers(0, 14)) * pf
            k0 = int(RNG.random() * 0.5 * SR)
            b = bell(f, 0.9, 2.0, 0.8)
            m = min(len(b), n - k0)
            y[k0:k0 + m] += b[:m] * 0.25
        return reverb(np.stack([y, np.roll(y, 600)]), IR_BIG, 0.5) * g * 0.45
    if name in ('whooshUp', 'whooshS', 'lift', 'swoosh', 'tracking', 'swipe'):
        d = {'whooshUp': 0.55, 'whooshS': 0.4, 'lift': 0.28, 'swoosh': 0.38, 'tracking': 0.7, 'swipe': 0.18}[name]
        w = whoosh(d, 400, 6000 if name != 'lift' else 3500, True)
        if name == 'tracking':
            w = w + sfx('shimmer', {'gain': 0.5})[:, :w.shape[1]] if False else w
        lvl = {'whooshUp': 0.5, 'whooshS': 0.4, 'lift': 0.22, 'swoosh': 0.35, 'tracking': 0.35, 'swipe': 0.25}[name]
        return w * g * lvl
    if name in ('whooshDown', 'whooshIn', 'morph'):
        d = {'whooshDown': 0.5, 'whooshIn': 0.45, 'morph': 0.4}[name]
        w = whoosh(d, 250, 5000, False)
        if name == 'morph':
            n = w.shape[1]
            t = tt(n)
            w += pan2(sine(300 * np.exp(-t / 0.15) + 90, n) * env_exp(n, 0.2) * 0.5, 0)
        return w * g * 0.45
    if name in ('popIn', 'popOut'):
        n = int(0.12 * SR)
        t = tt(n)
        f = (950 * np.exp(-t / 0.02) + 420) if name == 'popIn' else (520 + 700 * (1 - np.exp(-t / 0.02)))
        y = sine(f * pf, n) * env_exp(n, 0.035, 0.001) + hp(noise(n), 4000) * env_exp(n, 0.003) * 0.2
        return pan2(y, 0.15 if name == 'popOut' else -0.15) * g * 0.42
    if name == 'typing':
        d = dur or 0.4
        n = int(d * SR)
        y = np.zeros(n)
        tk = 0.0
        while tk < d - 0.02:
            i = int(tk * SR)
            m = int(0.012 * SR)
            y[i:i + m] += bp(noise(m), 2500, 7000) * env_exp(m, 0.002) * (0.5 + 0.5 * RNG.random())
            tk += 0.035 + RNG.random() * 0.045
        return pan2(y, -0.1) * g * 0.45
    if name == 'voice':
        d = dur or 0.7
        n = int(d * SR)
        t = tt(n)
        f0 = 190 + 25 * np.sin(2 * np.pi * 3 * t) + 15 * np.sin(2 * np.pi * 7.3 * t)
        src = saw(f0, n)
        y = bp(src, 500, 900) * 0.8 + bp(src, 1100, 1700) * 0.5
        y *= (0.6 + 0.4 * np.sin(2 * np.pi * 5.5 * t) ** 2) * adsr(n, 0.03, 0.1, 0.8, 0.12)
        return pan2(lp(y, 2500), 0.2) * g * 0.35
    if name == 'tick':
        n = int(0.1 * SR)
        y = (sine(2000 * pf, n) + 0.5 * sine(3000 * pf, n)) * env_exp(n, 0.018, 0.0005)
        return pan2(y, 0.1) * g * 0.3
    if name == 'riseTone':
        d = dur or 0.6
        n = int(d * SR)
        t = tt(n)
        f = 420 + 900 * (t / d) ** 1.4
        y = sine(f * (1 + 0.01 * np.sin(2 * np.pi * 7 * t)), n) * np.clip(t / 0.05, 0, 1) * (0.6 + 0.4 * t / d)
        return pan2(y, 0) * g * 0.16
    if name in ('ding', 'chime'):
        y = bell(1318.5 * pf, 1.3, 3.5, 1.6) * 0.6
        if name == 'chime':
            n2 = int(0.09 * SR)
            y2 = bell(1975.5 * pf, 1.1, 3.5, 1.4) * 0.5
            y = np.concatenate([y, np.zeros(n2)])
            y[n2:n2 + len(y2)] += y2[:len(y) - n2]
        return reverb(pan2(y, 0.2), IR_BIG, 0.3) * g * 0.4
    if name == 'drop':
        n = int(0.16 * SR)
        t = tt(n)
        y = sine(170 * np.exp(-t / 0.03) + 85, n) * env_exp(n, 0.05) + bp(noise(n), 800, 3000) * env_exp(n, 0.006) * 0.4
        return pan2(y, o.get('pan', 0)) * g * 0.5
    if name == 'zip':
        n = int(0.4 * SR)
        t = tt(n)
        y = lp(saw(300 + 2500 * (t / 0.4) ** 2, n), 5000) * np.sin(np.pi * t / 0.4) * 0.5
        w = whoosh(0.4, 600, 8000, True)
        return (w * 0.6 + pan2(y, 0)) * g * 0.35
    if name == 'downTone':
        n = int(0.5 * SR)
        t = tt(n)
        y = sine(620 - 300 * (t / 0.5), n) * env_exp(n, 0.25, 0.01)
        return pan2(y, 0) * g * 0.22
    if name == 'sparkle':
        n = int(0.9 * SR)
        y = np.zeros(n)
        for i, m in enumerate((84, 88, 91, 96, 91, 100)):
            k0 = int(i * 0.06 * SR)
            b = bell(midi(m), 0.6, 2.0, 0.7)
            mm = min(len(b), n - k0)
            y[k0:k0 + mm] += b[:mm] * 0.3
        return reverb(np.stack([y, np.roll(y, 500)]), IR_BIG, 0.35) * g * 0.4
    if name == 'thunk':
        n = int(0.3 * SR)
        t = tt(n)
        y = sine(230 * np.exp(-t / 0.04) + 95, n) * env_exp(n, 0.09) + bp(noise(n), 300, 1500) * env_exp(n, 0.02) * 0.6
        return reverb(pan2(y, 0), IR_ROOM, 0.2) * g * 0.6
    if name == 'notif':
        n = int(0.45 * SR)
        a = bell(880 * pf, 0.4, 2.0, 0.6)
        b = bell(1318.5 * pf, 0.4, 2.0, 0.6)
        y = np.zeros(n)
        y[:len(a)] += a * 0.5
        k0 = int(0.08 * SR)
        y[k0:k0 + len(b)] += b[:n - k0] * 0.5
        return pan2(y, 0.2) * g * 0.36
    if name == 'bell':
        n = int(1.5 * SR)
        y = np.zeros(n)
        for i in range(10):
            k0 = int(i * 0.07 * SR)
            b = bell(1760, 0.8, 2.76, 2.0) * (0.95 ** i) * (1 if i % 2 == 0 else 0.8)
            mm = min(len(b), n - k0)
            y[k0:k0 + mm] += b[:mm] * 0.3
        return reverb(pan2(y, 0.3), IR_ROOM, 0.25) * g * 0.42
    if name == 'paper':
        n = int(0.5 * SR)
        y = bp(noise(n), 1800, 7000) * np.sin(np.pi * tt(n) / 0.5) ** 2
        return pan2(y, -0.1) * g * 0.22
    if name == 'pen':
        d = dur or 1.0
        n = int(d * SR)
        t = tt(n)
        mod = np.abs(np.sin(2 * np.pi * 7 * t + 3 * np.sin(2 * np.pi * 1.3 * t))) ** 3
        y = bp(noise(n), 2500, 6000) * mod * adsr(n, 0.02, 0.1, 0.9, 0.08)
        return pan2(y, 0.1) * g * 0.28
    if name == 'stamp':
        n = int(0.6 * SR)
        t = tt(n)
        y = kick(n, 120, 50, 1.4) * 0.9 + lp(noise(n), 2200) * env_exp(n, 0.03, 0.0005) * 0.7
        return reverb(np.stack([y, y]), IR_ROOM, 0.35) * g * 0.8
    if name == 'odometer':
        d = dur or 0.9
        n = int(d * SR)
        y = np.zeros(n)
        tk = 0.0
        while tk < d - 0.01:
            i = int(tk * SR)
            m = int(0.008 * SR)
            y[i:i + m] += bp(noise(m), 1500, 5000) * env_exp(m, 0.0015)
            tk += 0.018 + 0.06 * (tk / d) ** 2
        return pan2(y, 0) * g * 0.35
    if name == 'kaching':
        n = int(1.0 * SR)
        y = np.zeros(n)
        cha = bp(noise(int(0.1 * SR)), 2000, 8000) * env_exp(int(0.1 * SR), 0.03)
        y[:len(cha)] += cha * 0.5
        for k0, f in ((0.03, 2637), (0.09, 3951), (0.09, 5274)):
            b = bell(f, 0.8, 2.0, 0.8)
            i = int(k0 * SR)
            mm = min(len(b), n - i)
            y[i:i + mm] += b[:mm] * 0.35
        for i in range(8):
            b = bell(midi(96 + RNG.integers(0, 8)), 0.2, 3.1, 0.5)
            k0 = int((0.12 + RNG.random() * 0.3) * SR)
            mm = min(len(b), n - k0)
            y[k0:k0 + mm] += b[:mm] * 0.12
        return reverb(np.stack([y, np.roll(y, 200)]), IR_ROOM, 0.25) * g * 0.55
    if name == 'confetti':
        n = int(0.9 * SR)
        y = hp(noise(n), 500) * env_exp(n, 0.02, 0.0005) * 0.8
        for i in range(40):
            k0 = int((0.03 + RNG.random() * 0.7) * SR)
            m = int(0.004 * SR)
            y[k0:k0 + m] += hp(noise(m), 3000) * RNG.random() * 0.4
        return np.stack([y, np.roll(y, 350)]) * g * 0.35
    if name == 'success':
        n = int(1.2 * SR)
        y = np.zeros(n)
        for i, m in enumerate((72, 76, 79, 84)):
            b = bell(midi(m), 0.9, 2.0, 0.9)
            k0 = int(i * 0.07 * SR)
            mm = min(len(b), n - k0)
            y[k0:k0 + mm] += b[:mm] * 0.3
        return reverb(np.stack([y, np.roll(y, 300)]), IR_BIG, 0.3) * g * 0.45
    if name == 'flip':
        w = whoosh(0.16, 800, 7000, True, 0.2)
        n = w.shape[1]
        w += pan2(hp(noise(n), 3000) * env_exp(n, 0.004) * 0.6, 0)
        return w * g * 0.35
    if name == 'blips':
        d = dur or 0.9
        n = int(d * SR)
        y = np.zeros(n)
        tk = 0.0
        while tk < d - 0.05:
            m = int(0.04 * SR)
            i = int(tk * SR)
            y[i:i + m] += sine(midi(84 + RNG.integers(0, 12)), m) * env_exp(m, 0.012)
            tk += 0.06 + RNG.random() * 0.05
        return pan2(y, 0.15) * g * 0.18
    if name == 'alert':
        n = int(0.22 * SR)
        t = tt(n)
        y = np.where(t < 0.1, square(880, n), square(660, n)) * env_exp(n, 0.12, 0.004)
        return pan2(lp(y, 3000), 0.1) * g * 0.16
    if name == 'beatHit':
        n = int(0.3 * SR)
        y = snare(n) * 0.6 + kick(n, 180 * pf, 80 * pf, 1.0) * 0.4
        return reverb(pan2(y, 0), IR_ROOM, 0.2) * g * 0.6
    if name == 'riser':
        d = dur or 2.0
        n = int(d * SR)
        t = tt(n)
        x = sweep_filter(noise(n), lambda tc: 300 + 9000 * (tc / d) ** 2, 'low')
        tone = saw(110 * 2 ** (2 * t / d), n) * 0.25
        e = (t / d) ** 2
        return norm(np.stack([(x + tone) * e, (np.roll(x, 300) + tone) * e]), 0.7) * g * 0.45
    if name == 'spinUp':
        d = dur or 0.5
        n = int(d * SR)
        t = tt(n)
        rate = 8 + 50 * (t / d) ** 2
        trem = 0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(rate) / SR)
        x = bp(noise(n), 800, 6000) * trem * (t / d)
        return pan2(x, 0) * g * 0.4
    if name == 'tap':
        n = int(0.15 * SR)
        t = tt(n)
        y = sine(1200 * np.exp(-t / 0.01) + 500, n) * env_exp(n, 0.03, 0.0005) + hp(noise(n), 4000) * env_exp(n, 0.002) * 0.4
        return pan2(y, 0.1) * g * 0.5
    raise ValueError('efeito sem síntese: ' + name)


def lufs(x):
    """Loudness integrado (ITU-R BS.1770-4) de um sinal estéreo (2, n) a 48 kHz."""
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=1), axis=1)
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    z = np.array([np.sum(np.mean(y[:, i:i + blk] ** 2, axis=1)) for i in range(0, y.shape[1] - blk, hop)])
    lk = -0.691 + 10 * np.log10(z + 1e-12)
    z1 = z[lk > -70]
    rel = -0.691 + 10 * np.log10(np.mean(z1)) - 10
    z2 = z[(lk > -70) & (lk > rel)]
    return -0.691 + 10 * np.log10(np.mean(z2))


def main():
    cues = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    mus = build_music()
    fx = np.zeros((2, N))
    for c in cues:
        x = sfx(c['name'], c)
        place(fx, x, c['t'])
    mix = mus * 0.62 + fx * 0.78
    if len(sys.argv) > 3:
        # versão narrada: a música abaixa ~8 dB e os efeitos ~4 dB enquanto a voz fala
        from scipy.io import wavfile as _wf
        _, v = _wf.read(sys.argv[3])
        v = v.astype(float).T / 32768
        vo = np.zeros((2, N))
        vo[:, :min(N, v.shape[1])] = v[:, :N]
        env = signal.sosfilt(signal.butter(1, 7, 'low', fs=SR, output='sos'), np.abs(vo[0]))
        act = np.clip(env / 0.045, 0, 1)
        act = signal.sosfiltfilt(signal.butter(1, 3, 'low', fs=SR, output='sos'), act).clip(0, 1)
        bed = mus * 0.62 * (1 - 0.6 * act) + fx * 0.78 * (1 - 0.35 * act)
        on = act > 0.5
        rms_bed = np.sqrt(np.mean((mus * 0.62 + fx * 0.78)[:, int(5 * SR):int(35 * SR)] ** 2))
        rms_vo = np.sqrt(np.mean(vo[:, on] ** 2)) if on.any() else 1.0
        mix = bed + vo * (rms_bed / rms_vo) * 1.15
        # mesmo nível de entrada no master que a versão sem voz (evita esmagar a dinâmica)
        ref = mus * 0.62 + fx * 0.78
        mix *= np.sqrt(np.mean(ref ** 2)) / np.sqrt(np.mean(mix ** 2))
    # master: graves limpos, compressão suave e limitador
    mix = np.stack([hp(mix[0], 28), hp(mix[1], 28)])
    env = np.maximum(np.abs(mix[0]), np.abs(mix[1]))
    env = signal.sosfilt(signal.butter(1, 8, 'low', fs=SR, output='sos'), env)
    thr = 0.5
    gain = np.where(env > thr, (thr + (env - thr) / 3) / (env + 1e-9), 1.0)
    mix *= gain
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    mix = norm(mix, 0.89)
    # loudness padrão das plataformas: -14 LUFS (só abaixa; o pico já está em -1 dBFS)
    L = lufs(mix)
    if L > -14.0:
        mix *= 10 ** ((-14.0 - L) / 20)
    print(f'loudness {L:.1f} → {lufs(mix):.1f} LUFS')
    # fade de 0,3 s no fim
    nf = int(0.3 * SR)
    mix[:, -nf:] *= np.linspace(1, 0, nf)
    pcm = (np.clip(mix, -1, 1) * 32767).astype(np.int16).T
    from scipy.io import wavfile
    wavfile.write(out, SR, pcm)
    print('ok', out, pcm.shape, 'pico', float(np.max(np.abs(mix))))


if __name__ == '__main__':
    main()
