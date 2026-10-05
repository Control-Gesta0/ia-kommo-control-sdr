#!/usr/bin/env bash
# Render final de um formato: quadros com motion blur (SUB subquadros, obturador 180°) → MP4 com a trilha.
# Codificação em 2 passadas (~4,7 Mbps) para o arquivo ficar abaixo de 30 MB.
# Uso: tools/build.sh v|h <pasta_saida> <trilha.wav>
set -euo pipefail
FMT=${1:-v}; OUT=${2:-out}; WAV=${3:-$OUT/trilha.wav}
FPS=30; SUB=${SUB:-6}; VBR=${VBR:-4700k}
NAME=$([ "$FMT" = "h" ] && echo "16x9" || echo "9x16")
cd "$(dirname "$0")/.."
rm -rf "$OUT/frames_$FMT"
node tools/render.mjs --fmt "$FMT" --fps $FPS --sub $SUB --shutter 0.5 --scale 1 --workers 4 --q 92 --cdp --out "$OUT/frames_$FMT"
WEIGHTS=$(printf '1 %.0s' $(seq $SUB) | sed 's/ $//')
VF="[0:v]tmix=frames=$SUB:weights='$WEIGHTS',select='eq(mod(n\,$SUB)\,$((SUB - 1)))',setpts=N/($FPS*TB),format=yuv420p[v]"
ENC="-c:v libx264 -preset slow -profile:v high -b:v $VBR -maxrate 9000k -bufsize 12000k -passlogfile $OUT/x264_$FMT"
ffmpeg -hide_banner -loglevel error -y -framerate $((FPS * SUB)) -i "$OUT/frames_$FMT/f_%05d.jpg" -filter_complex "$VF" -map "[v]" -r $FPS $ENC -pass 1 -an -f mp4 /dev/null
ffmpeg -hide_banner -loglevel error -y -framerate $((FPS * SUB)) -i "$OUT/frames_$FMT/f_%05d.jpg" -i "$WAV" -filter_complex "$VF" \
  -map "[v]" -map 1:a -r $FPS $ENC -pass 2 -c:a aac -b:a 160k -movflags +faststart -shortest "$OUT/do-oi-ao-pago_$NAME.mp4"
rm -f "$OUT"/x264_"$FMT"*
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration,size,bit_rate -of default=nw=1 "$OUT/do-oi-ao-pago_$NAME.mp4"
