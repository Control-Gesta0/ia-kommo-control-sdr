#!/usr/bin/env bash
# Render final de um formato: quadros com motion blur (4 subquadros, obturador 180°) → MP4 com a trilha.
# Uso: tools/build.sh v|h <pasta_saida> <trilha.wav>
set -euo pipefail
FMT=${1:-v}; OUT=${2:-out}; WAV=${3:-$OUT/trilha.wav}
FPS=30; SUB=4
NAME=$([ "$FMT" = "h" ] && echo "16x9" || echo "9x16")
cd "$(dirname "$0")/.."
rm -rf "$OUT/frames_$FMT"
node tools/render.mjs --fmt "$FMT" --fps $FPS --sub $SUB --shutter 0.5 --scale 1 --workers 4 --q 92 --cdp --out "$OUT/frames_$FMT"
ffmpeg -hide_banner -loglevel error -y -framerate $((FPS * SUB)) -i "$OUT/frames_$FMT/f_%05d.jpg" -i "$WAV" \
  -filter_complex "[0:v]tmix=frames=$SUB:weights='1 1 1 1',select='eq(mod(n\,$SUB)\,$((SUB - 1)))',setpts=N/($FPS*TB),format=yuv420p[v]" \
  -map "[v]" -map 1:a -r $FPS -c:v libx264 -preset slow -crf 19 -maxrate 14M -bufsize 28M -profile:v high \
  -c:a aac -b:a 192k -movflags +faststart -shortest "$OUT/do-oi-ao-pago_$NAME.mp4"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration,size,bit_rate -of default=nw=1 "$OUT/do-oi-ao-pago_$NAME.mp4"
