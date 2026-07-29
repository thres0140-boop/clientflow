// Client-safe helper (no server imports) for <video src>.
// Cloudflare's public r2.dev URLs are rate-limited and not meant for production traffic — direct
// browser hits get throttled once usage crosses a threshold (videos "suddenly" stop loading).
// Routing playback through our /api/vid proxy sidesteps that (Vercel's egress isn't throttled the
// same way) and also covers expired Instagram CDN links and the dead Cloudinary account.
export function videoSrc(url?: string | null): string {
  if (!url) return "";
  if (/\.r2\.dev\//.test(url) || /res\.cloudinary\.com/.test(url) || /cdninstagram\.com|fbcdn\.net/.test(url)) {
    return `/api/vid?u=${encodeURIComponent(url)}`;
  }
  return url;
}
