#!/bin/sh
# Opens a render in the booted iPhone simulator's Safari and records peak WebContent RSS until the result lands.
# usage: run-sim.sh <url> <name> <timeoutSec>
URL="$1"; NAME="$2"; T="${3:-900}"; OUT="results/$NAME.json"; rm -f "$OUT"
xcrun simctl openurl booted "$URL"
PEAK=0; START=$(date +%s)
while [ ! -f "$OUT" ]; do
  NOW=$(ps -axo rss=,args= | grep "com.apple.WebKit.WebContent" | grep -v grep | awk '{ if ($1>m) m=$1 } END { print int(m/1024) }')
  [ "${NOW:-0}" -gt "$PEAK" ] && PEAK=$NOW
  [ $(( $(date +%s) - START )) -gt "$T" ] && { echo "{\"name\":\"$NAME\",\"ok\":false,\"error\":\"timeout\"}" > "$OUT"; break; }
  sleep 0.5
done
node -e 'const f=process.argv[1];const j=require("./"+f);j.peakWebContentRssMB=Number(process.argv[2]);require("fs").writeFileSync(f,JSON.stringify(j,null,2));delete j.tail;delete j.ua;console.log(j)' "$OUT" "$PEAK"
