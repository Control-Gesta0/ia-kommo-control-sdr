"""Locução do vídeo. Voz escolhida pelo cliente: Microsoft Thalita (pt-BR-ThalitaMultilingualNeural).

Motores:
  azure  — produção. Azure AI Speech com SSML: <lang xml:lang="pt-BR"> força a leitura em português do Brasil
           em toda fala (a Thalita é multilíngue e, sem isso, lê "Control" em inglês). Precisa de
           AZURE_SPEECH_KEY e AZURE_SPEECH_REGION no ambiente.
  edge   — prévia. Mesma voz pelo leitor do navegador Edge (pacote edge-tts). Serve para aprovar texto e ritmo;
           não é licenciado para uso comercial.
  kokoro — alternativa local (Apache 2.0). Modelos em github.com/thewh1teagle/kokoro-onnx (model-files-v1.0).

Cada fala tem entrada amarrada à cena e um fim máximo. Se passar, a velocidade sobe de 5 em 5% (até +20%).
O texto já vem escrito para a voz: "Contrôl" (con-TRÔL, pronúncia aprovada pelo cliente), "I.A." (soletrado, mais curto que
"inteligência artificial"), e nenhuma frase de uma palavra só (a voz multilíngue erra o idioma nelas).

Uso: python3 audio/narracao.py out/voz.wav [azure|edge|kokoro] [--kokoro-dir DIR]
"""
import asyncio
import json
import os
import subprocess
import sys
import urllib.request

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 43.0
VOZ_MS = 'pt-BR-ThalitaMultilingualNeural'

# (entrada em s, fim máximo em s, texto falado)
FALAS = [
    (0.30, 1.85, 'Seu cliente chamou…'),
    (2.00, 3.30, 'e ninguém respondeu.'),
    (3.62, 4.70, 'Até agora.'),
    (5.30, 8.90, 'A I.A. responde na hora, a qualquer hora, e entende até áudio.'),
    (9.08, 10.95, 'E faz a qualificação sozinha.'),
    (11.38, 14.90, 'No Kommo, cada card anda sozinho pelo funil.'),
    (15.25, 17.55, 'Se o cliente some, ela chama de volta.'),
    (17.65, 20.95, 'Marca a reunião direto na agenda do vendedor.'),
    (21.10, 23.05, 'Manda os lembretes e cria as tarefas.'),
    (23.20, 26.95, 'O contrato é assinado digitalmente e volta direto pro card.'),
    (27.15, 30.90, 'Pagamento feito? O valor cai direto no card.'),
    (31.20, 34.70, 'Se atrasar, ela cobra no WhatsApp, com o Pix pronto.'),
    (37.25, 38.40, 'Contrôl Gestão.'),
    (38.45, 39.35, 'Do oi ao pago.'),
    (39.40, 41.40, 'I.A. no Kommo, de ponta a ponta.'),
    (41.45, 42.80, 'Chama a gente no Insta.'),
]


def trim(x, sr, thr=0.01):
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(0.01 * sr))
    b = min(len(x), idx[-1] + int(0.04 * sr))
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
    e = np.zeros_like(env)
    prev = 0.0
    for i in range(len(env)):
        v = env[i]
        prev = a_att * prev + (1 - a_att) * v if v > prev else a_rel * prev + (1 - a_rel) * v
        e[i] = prev
    lvl = 20 * np.log10(e + 1e-9)
    over = np.maximum(0, lvl - thr_db)
    return x * 10 ** (-(over - over / ratio) / 20)


def tratar_voz(x):
    """Cadeia de locução: passa-altas, corpo, presença, compressão e sibilância suavizada."""
    x = signal.sosfilt(signal.butter(2, 90, 'high', fs=SR, output='sos'), x)
    x = peaking(x, 220, 1.5, 0.8)
    x = peaking(x, 3200, 3.0, 0.9)
    x = peaking(x, 7500, -2.0, 1.2)
    return compress(x, -22, 3.2)


def decode(data_or_path):
    """Qualquer áudio (bytes ou caminho) → mono float em 48 kHz, via ffmpeg."""
    if isinstance(data_or_path, bytes):
        p = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'], input=data_or_path, capture_output=True, check=True)
    else:
        p = subprocess.run(['ffmpeg', '-v', 'error', '-i', data_or_path, '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.int16).astype(float) / 32768


def fala_azure(texto, rate):
    key, region = os.environ['AZURE_SPEECH_KEY'], os.environ['AZURE_SPEECH_REGION']
    esc = texto.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    ssml = (f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='pt-BR'>"
            f"<voice name='{VOZ_MS}'><lang xml:lang='pt-BR'><prosody rate='{rate:+d}%'>{esc}</prosody></lang></voice></speak>")
    req = urllib.request.Request(f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1', data=ssml.encode('utf-8'), method='POST', headers={
        'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm', 'User-Agent': 'showreel-control-gestao'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return decode(r.read())


def fala_edge(texto, rate):
    import edge_tts
    tmp = '/tmp/_fala_edge.mp3'

    async def go():
        await edge_tts.Communicate(texto, VOZ_MS, rate=f'{rate:+d}%', proxy=os.environ.get('HTTPS_PROXY')).save(tmp)
    asyncio.run(go())
    return decode(tmp)


_KOKORO = None


def fala_kokoro(texto, rate, kdir):
    global _KOKORO
    from kokoro_onnx import Kokoro
    if _KOKORO is None:
        _KOKORO = Kokoro(os.path.join(kdir, 'kokoro-v1.0.onnx'), os.path.join(kdir, 'voices-v1.0.bin'))
    s, sr = _KOKORO.create(texto, voice='pf_dora', speed=1 + rate / 100, lang='pt-br')
    return signal.resample_poly(np.asarray(s, dtype=float), SR, sr)


def main():
    out = sys.argv[1]
    motor = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else ('azure' if os.environ.get('AZURE_SPEECH_KEY') else 'edge')
    kdir = sys.argv[sys.argv.index('--kokoro-dir') + 1] if '--kokoro-dir' in sys.argv else '.'
    gerar = {'azure': fala_azure, 'edge': fala_edge, 'kokoro': lambda t, r: fala_kokoro(t, r, kdir)}[motor]
    track = np.zeros(int(SR * DUR))
    rel = []
    for t0, t1, txt in FALAS:
        rate = 0
        while True:
            y = trim(gerar(txt, rate), SR)
            if len(y) / SR <= t1 - t0 or rate >= 20:
                break
            rate += 5
        y = tratar_voz(y)
        y = y / (np.max(np.abs(y)) + 1e-9) * 0.9
        i = int(t0 * SR)
        n = min(len(y), len(track) - i)
        track[i:i + n] += y[:n]
        fim = t0 + len(y) / SR
        rel.append({'t': t0, 'fim': round(fim, 2), 'janela_fim': t1, 'velocidade': f'{rate:+d}%', 'texto': txt})
        print(f'{t0:6.2f}s  {len(y) / SR:4.2f}s  {rate:+3d}%  {txt}' + ('' if fim <= t1 + 0.05 else '  <-- passou da janela'))
    track = track / (np.max(np.abs(track)) + 1e-9) * 0.9
    wavfile.write(out, SR, (np.stack([track, track]).T * 32767).astype(np.int16))
    json.dump({'motor': motor, 'voz': VOZ_MS if motor != 'kokoro' else 'pf_dora', 'falas': rel}, open(out.replace('.wav', '.json'), 'w'), ensure_ascii=False, indent=1)
    print('ok', out, '·', motor)


if __name__ == '__main__':
    main()
