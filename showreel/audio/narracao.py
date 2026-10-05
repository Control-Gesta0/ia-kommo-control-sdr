"""Locução do vídeo com voz neural local (Kokoro-82M, licença Apache 2.0, uso comercial liberado).

Cada fala tem um tempo de entrada amarrado à cena (mesma linha do tempo das animações) e uma janela máxima.
Se a fala gerada passar da janela, a velocidade sobe aos poucos (até 1,18x) para caber sem cortar palavra.

Modelos (não versionados, ~350 MB):
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

Uso: python3 audio/narracao.py <kokoro-v1.0.onnx> <voices-v1.0.bin> out/voz.wav [voz]
"""
import json
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 43.0

# (entrada em s, fim máximo em s, texto falado). O texto é escrito para a voz: "Insta", "pro", "card".
FALAS = [
    (0.30, 1.85, 'Seu cliente chamou…'),
    (2.00, 3.30, 'e ninguém respondeu.'),
    (3.62, 4.70, 'Até agora.'),
    (5.30, 8.90, 'A IA responde na hora. A qualquer hora. E entende até áudio.'),
    (9.08, 10.95, 'Já qualifica o cliente, sozinha.'),
    (11.38, 14.90, 'No Kommo, cada card anda sozinho pelo funil.'),
    (15.30, 17.40, 'Sumiu? A IA chama de volta.'),
    (17.65, 20.95, 'Marca a reunião direto na agenda do vendedor.'),
    (21.10, 22.85, 'Manda lembrete. Cria tarefa.'),
    (23.20, 26.95, 'O contrato é assinado digitalmente e volta direto pro card.'),
    (27.15, 30.90, 'Pagou? O valor da venda cai direto no card.'),
    (31.20, 34.70, 'Atrasou? Ela cobra no WhatsApp, com o Pix pronto.'),
    (37.42, 38.40, 'Control Gestão.'),
    (38.45, 39.35, 'Do oi ao pago.'),
    (39.40, 41.15, 'IA no Kommo, de ponta a ponta.'),
    (41.25, 42.75, 'Chama a gente no Insta.'),
]


def trim(x, thr=0.01):
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(0.01 * 24000))
    b = min(len(x), idx[-1] + int(0.04 * 24000))
    return x[a:b]


def peaking(x, f0, gain_db, q=1.0):
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / SR
    alpha = np.sin(w0) / (2 * q)
    b = [1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a]
    aa = [1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a]
    return signal.lfilter(b, aa, x)


def compress(x, thr_db=-20, ratio=3.0, att=0.005, rel=0.12):
    env = np.abs(x)
    a_att = np.exp(-1 / (att * SR))
    a_rel = np.exp(-1 / (rel * SR))
    # seguidor de envelope (vetorizado por blocos é suficiente para voz curta)
    e = np.zeros_like(env)
    prev = 0.0
    for i in range(len(env)):
        v = env[i]
        prev = a_att * prev + (1 - a_att) * v if v > prev else a_rel * prev + (1 - a_rel) * v
        e[i] = prev
    lvl = 20 * np.log10(e + 1e-9)
    over = np.maximum(0, lvl - thr_db)
    gain = 10 ** (-(over - over / ratio) / 20)
    return x * gain


def tratar_voz(x):
    """Cadeia de locução: passa-altas, corpo, presença, compressão e brilho leve."""
    x = signal.sosfilt(signal.butter(2, 90, 'high', fs=SR, output='sos'), x)
    x = peaking(x, 220, 1.5, 0.8)
    x = peaking(x, 3200, 3.0, 0.9)
    x = peaking(x, 7500, -2.0, 1.2)  # suaviza sibilância
    x = compress(x, -22, 3.2)
    return x


def main():
    from kokoro_onnx import Kokoro
    model, voices, out = sys.argv[1], sys.argv[2], sys.argv[3]
    voz = sys.argv[4] if len(sys.argv) > 4 else 'pf_dora'
    k = Kokoro(model, voices)
    track = np.zeros(int(SR * DUR))
    rel = []
    for t0, t1, txt in FALAS:
        janela = t1 - t0
        speed = 1.0
        while True:
            s, sr = k.create(txt, voice=voz, speed=speed, lang='pt-br')
            s = trim(np.asarray(s, dtype=float))
            dur = len(s) / sr
            if dur <= janela or speed >= 1.18:
                break
            speed = min(1.18, speed * min(1.06, dur / janela + 0.01))
        y = signal.resample_poly(s, SR, sr)
        y = tratar_voz(y)
        y = y / (np.max(np.abs(y)) + 1e-9) * 0.9
        i = int(t0 * SR)
        n = min(len(y), len(track) - i)
        track[i:i + n] += y[:n]
        rel.append({'t': t0, 'fim': round(t0 + len(y) / SR, 2), 'janela_fim': t1, 'velocidade': round(speed, 3), 'texto': txt})
        flag = '' if t0 + len(y) / SR <= t1 + 0.05 else '  <-- passou da janela'
        print(f'{t0:6.2f}s  {len(y) / SR:4.2f}s  x{speed:.2f}  {txt}{flag}')
    track = track / (np.max(np.abs(track)) + 1e-9) * 0.9
    st = np.stack([track, track]).T
    wavfile.write(out, SR, (st * 32767).astype(np.int16))
    json.dump(rel, open(out.replace('.wav', '.json'), 'w'), ensure_ascii=False, indent=1)
    print('ok', out)


if __name__ == '__main__':
    main()
