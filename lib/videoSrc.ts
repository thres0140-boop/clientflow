// Client-safe media helpers (no server imports) for <video>/<img> src.
// Cloudflare's public r2.dev URLs are rate-limited and not meant for production traffic — direct
// browser hits get throttled once usage crosses a threshold (media "suddenly" stops loading).
// Routing through our /api/vid and /api/img proxies sidesteps that (Vercel's egress isn't
// throttled the same way) and also covers expired Instagram CDN links and the dead Cloudinary.
function shouldProxy(url: string): boolean {
  return /\.r2\.dev\//.test(url) || /res\.cloudinary\.com/.test(url) || /cdninstagram\.com|fbcdn\.net/.test(url);
}

export function videoSrc(url?: string | null): string {
  if (!url) return "";
  if (url.startsWith("/api/")) return url;           // already proxied
  return shouldProxy(url) ? `/api/vid?u=${encodeURIComponent(url)}` : url;
}

export function imgSrc(url?: string | null): string {
  if (!url) return "";
  if (url.startsWith("/api/")) return url;           // already proxied
  return shouldProxy(url) ? `/api/img?u=${encodeURIComponent(url)}` : url;
}
