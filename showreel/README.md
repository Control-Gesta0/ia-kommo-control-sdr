# Showreel "Do oi ao pago." · Control Gestão × Kommo

Vídeo de 43 s em motion graphics (9:16 e 16:9) mostrando a IA atendendo, qualificando, movendo o funil,
agendando, lembrando, assinando contrato, recebendo e cobrando dentro do Kommo.

Tudo é código: as cenas são HTML/CSS/SVG animados por um motor determinístico (cada quadro é função do tempo),
renderizados quadro a quadro no Chromium headless e montados com ffmpeg. A trilha e os efeitos são sintetizados
em Python, sem samples de terceiros. Por isso dá para trocar textos, nomes, valores e cores e renderizar de novo.

## Renderizar

Requisitos: Node 22, Python 3 com `numpy` e `scipy`, ffmpeg e o Chromium do Playwright.

```bash
cd showreel
npm install
mkdir -p out
node tools/render.mjs --fmt v --cues audio/cues.json        # deixas de som que as cenas registram
python3 audio/make_audio.py audio/cues.json out/trilha.wav   # trilha + efeitos sincronizados
tools/build.sh v out out/trilha.wav                         # 1080x1920 → out/do-oi-ao-pago_9x16.mp4
tools/build.sh h out out/trilha.wav                         # 1920x1080 → out/do-oi-ao-pago_16x9.mp4
```

### Versão narrada (voz Thalita, Microsoft)

A locução está em `audio/narracao.py`: 16 falas amarradas ao tempo das cenas, escritas para a voz
("Contrôl Gestão" com ô fechado, "I.A." soletrado, sem frases de uma palavra só). A música abaixa sozinha
enquanto a voz fala e o resultado é normalizado em -14 LUFS.

```bash
pip install edge-tts                                          # só para prévia (leitor do Edge, não comercial)
python3 audio/narracao.py out/voz.wav azure                   # produção: precisa de AZURE_SPEECH_KEY e AZURE_SPEECH_REGION
python3 audio/make_audio.py audio/cues.json out/trilha_narrada.wav out/voz.wav
ffmpeg -i out/do-oi-ao-pago_9x16.mp4 -i out/trilha_narrada.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 160k \
  -shortest -movflags +faststart out/do-oi-ao-pago_narrado_9x16.mp4             # idem para 16x9
```

Pela Azure, o SSML força português do Brasil em toda fala (`<lang xml:lang="pt-BR">`), o que deixa a pronúncia
estável. O plano gratuito da Azure (F0) cobre a locução inteira (~700 caracteres).

### Capa do Reels

`capa/capa.html` (1080×1920). Logo, título e frase ficam dentro do recorte 3:4 que o Instagram usa no grid
do perfil (de y=240 a y=1680); o @ fica fora, só aparece no Reels em tela cheia. `?guias` mostra as linhas.

```bash
node tools/capa.mjs out/capa_reels.png            # --guias para ver os recortes 3:4 (vermelho) e 1:1 (azul)
```

Prévia rápida de quadros soltos (útil para revisar sem renderizar tudo):

```bash
node tools/render.mjs --fmt v --stills 5.2,11.8,28.0,38.8 --scale 0.5 --out out/stills
```

## Onde mexer

| O quê | Arquivo |
|---|---|
| Linha do tempo de cada cena, textos e animação | `js/s01-caos.js` … `js/s13-logo.js` |
| Títulos cinéticos, card do Kommo, pílula da IA, participações 3D | `js/ui.js` |
| Fundo, HUD, flash, luz vazada, tremida | `js/globals.js` |
| Cores, fontes e componentes | `css/style.css` |
| Música (progressão, bateria, timbres), efeitos e mixagem com a voz | `audio/make_audio.py` |
| Texto e tempo da locução | `audio/narracao.py` |

## Créditos e cuidados

- Símbolo da Control Gestão vetorizado a partir do logo oficial (`assets/img/cg-symbol.svg`).
- Personagens 3D, ícones de canais e selo "Kommo partner" são materiais públicos da Kommo, usados como parceiro.
  Antes de impulsionar o vídeo em anúncio pago, vale confirmar com o gerente de parceria da Kommo.
- Leads, empresas, valores e telefones no vídeo são fictícios. Nenhum print com dado real de cliente entra nesta pasta.
- Ferramentas de terceiros (ZapSign, Asaas, Conta Azul) aparecem só como texto, sem logos.
