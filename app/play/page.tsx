"use client";

import { useEffect, useState } from "react";

// Minimal full-bleed video player, designed to be embedded in an <iframe> on the
// Strategy Board. Plays either a direct video URL (?src=, optionally &proxy=1 to route
// through /api/vid) or a competitor reel by id (?reel=<CompetitorReel id>), which it
// resolves to a fresh playable URL and streams via the /api/vid proxy.
export default function PlayPage() {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const src = p.get("src");
    const proxy = p.get("proxy") === "1";
    const reel = p.get("reel");
    setPoster(p.get("poster"));
    let cancelled = false;

    (async () => {
      if (reel) {
        try {
          const d = await fetch(`/api/competitors/reel-media?id=${encodeURIComponent(reel)}`).then((r) => r.json());
          if (cancelled) return;
          if (d?.url) setUrl(`/api/vid?u=${encodeURIComponent(d.url)}`);
          else setErr(true);
        } catch { if (!cancelled) setErr(true); }
      } else if (src) {
        setUrl(proxy ? `/api/vid?u=${encodeURIComponent(src)}` : src);
      } else {
        setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {err ? (
        <p style={{ color: "rgba(255,255,255,.6)", fontFamily: "system-ui, sans-serif", fontSize: 13 }}>Couldn&apos;t load this video.</p>
      ) : url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={url} poster={poster || undefined} controls playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
      ) : (
        <div style={{ width: 28, height: 28, border: "2px solid rgba(255,255,255,.6)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
