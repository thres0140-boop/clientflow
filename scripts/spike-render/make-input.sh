#!/bin/sh
# Generates the spike's test job: a 60 s 1080x1920 30 fps H.264 clip (~8 Mbps, AAC stereo) plus a
# 76-cue word-timed ASS caption file in the bottom-third TikTok style. Needs a native ffmpeg.
# usage: ./make-input.sh <outdir>   (also drop a Roboto-Bold.ttf into <outdir>/fonts)
set -e
OUT="${1:-media}"; mkdir -p "$OUT/fonts"; cd "$OUT"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=1080x1920:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 60 \
  -c:v libx264 -preset medium -b:v 8M -maxrate 9M -bufsize 16M -pix_fmt yuv420p -profile:v high -c:a aac -ac 2 -b:a 128k -movflags +faststart input.mp4
node -e '
const words="dit is precies waarom de meeste coaches nooit groeien op instagram want ze posten alleen maar random content zonder plan en dan vragen ze zich af waarom er niets gebeurt".split(" ");
const fmt=t=>{const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=(t%60).toFixed(2).padStart(5,"0");return `${h}:${String(m).padStart(2,"0")}:${s}`};
let out=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Cap,Roboto,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,60,60,420,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
const total=150, dur=60, per=dur/total; let i=0;
for(let t=0;t<dur;t+=per*2){ const a=words[i++%words.length].toUpperCase(), b=words[i++%words.length].toUpperCase(); out+=`Dialogue: 0,${fmt(t)},${fmt(Math.min(dur,t+per*2))},Cap,,0,0,0,,${a} ${b}\n`; }
require("fs").writeFileSync("captions.ass",out);'
echo "wrote $OUT/input.mp4 and $OUT/captions.ass"
