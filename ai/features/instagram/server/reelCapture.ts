import { prisma } from "@/ai/db/prisma";
import { freshReelMediaUrl } from "@/ai/features/instagram/server/scrapeCompetitors";
import { uploadToR2, isR2Url } from "@/ai/shared/media/r2";

// Capture-once architecture for competitor reels. Instagram CDN video URLs expire within
// hours and IG blocks unauthenticated access, so the paid scraper endpoint is unreliable
// (oscillates between resolving and "not found"). The fix: the FIRST time a reel resolves,
// download the mp4 into our own R2 bucket and transcribe it once — then playback and
// transcription read our copies forever and never touch the vendor again. A "not found"
// from the vendor is never fatal: we leave the reel pending and a later pass retries.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36";
const GIVE_UP_AFTER = 25; // capture passes before we flag a reel unavailable for manual review

type ReelRow = {
  id: number; shortcode: string; cachedVideoUrl: string | null;
  transcript: string | null; captureTries: number;
  mediaUrl: string | null; mediaUrlAt: Date | null;
  competitor?: { handle: string | null } | null;
};

async function loadReel(reelId: number): Promise<ReelRow | null> {
  return (prisma as any).competitorReel.findUnique({
    where: { id: reelId },
    select: { id: true, shortcode: true, cachedVideoUrl: true, transcript: true, captureTries: true, mediaUrl: true, mediaUrlAt: true, competitor: { select: { handle: true } } },
  });
}

const MAX_VIDEO_BYTES = 80 * 1024 * 1024; // guardrail: don't buffer a huge file into memory (OOM)

// Download an IG CDN video (browser UA — IG 403s plain server fetches) and push to R2.
async function downloadToR2(srcUrl: string, key: string): Promise<{ url: string; bytes: Buffer } | null> {
  try {
    const res = await fetch(srcUrl, { headers: { "User-Agent": UA, Accept: "video/*,*/*", Referer: "https://www.instagram.com/" }, signal: AbortSignal.timeout(45000) });
    if (!res.ok) return null;
    const len = parseInt(res.headers.get("content-length") || "0");
    if (len && len > MAX_VIDEO_BYTES) return null; // too big to buffer safely — skip
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.byteLength > MAX_VIDEO_BYTES) return null;
    const url = await uploadToR2(key, bytes, res.headers.get("content-type") || "video/mp4");
    return url ? { url, bytes } : null;
  } catch { return null; }
}

// Ensure we have a permanent R2 copy of the reel's mp4. Returns the R2 url (preferred),
// or a fresh ephemeral IG url as a last resort so it at least plays right now, or null.
// `videoBytes` is returned when we just downloaded it, so the transcriber can reuse it.
export async function ensureReelVideo(reelId: number): Promise<{ url: string | null; permanent: boolean; bytes?: Buffer }> {
  const reel = await loadReel(reelId);
  if (!reel) return { url: null, permanent: false };
  if (reel.cachedVideoUrl && isR2Url(reel.cachedVideoUrl)) return { url: reel.cachedVideoUrl, permanent: true };

  // FAST PATH: the scrape usually already grabbed a fresh video URL. If it's recent (< 55 min,
  // safely inside Instagram's signed-URL lifetime) download THAT straight to R2 — no vendor
  // call, no rate limit. This is what makes freshly-scraped reels cache almost immediately.
  const FRESH_MS = 55 * 60_000;
  if (reel.mediaUrl && reel.mediaUrlAt && Date.now() - new Date(reel.mediaUrlAt).getTime() < FRESH_MS) {
    const dl = await downloadToR2(reel.mediaUrl, `comp-videos/${reelId}.mp4`);
    if (dl) {
      await (prisma as any).competitorReel.update({
        where: { id: reelId },
        data: { cachedVideoUrl: dl.url, captureStatus: reel.transcript ? "done" : "pending" },
      }).catch(() => {});
      return { url: dl.url, permanent: true, bytes: dl.bytes };
    }
    // else fall through to a fresh vendor resolve below
  }

  const handle = reel.competitor?.handle || "";
  const fresh = handle ? await freshReelMediaUrl(handle, reel.shortcode) : null;
  if (!fresh) {
    // Vendor is in a bad window — leave pending, bump the counter, retry on a later pass.
    const tries = (reel.captureTries || 0) + 1;
    await (prisma as any).competitorReel.update({
      where: { id: reelId },
      data: { captureTries: tries, captureStatus: tries >= GIVE_UP_AFTER ? "unavailable" : "pending" },
    }).catch(() => {});
    return { url: null, permanent: false };
  }

  const dl = await downloadToR2(fresh, `comp-videos/${reelId}.mp4`);
  if (!dl) {
    // Resolved but the download/upload failed (oversized, CDN hiccup). Still bump the counter
    // so this reel doesn't sit at the front of the queue forever blocking the backfill.
    const tries = (reel.captureTries || 0) + 1;
    await (prisma as any).competitorReel.update({
      where: { id: reelId },
      data: { captureTries: tries, captureStatus: tries >= GIVE_UP_AFTER ? "unavailable" : "pending" },
    }).catch(() => {});
    return { url: fresh, permanent: false };
  }
  await (prisma as any).competitorReel.update({
    where: { id: reelId },
    data: { cachedVideoUrl: dl.url, captureStatus: reel.transcript ? "done" : "pending" },
  }).catch(() => {});
  return { url: dl.url, permanent: true, bytes: dl.bytes };
}

const HALLUCINATIONS = new Set([
  "thanks for watching", "thank you for watching", "thank you", "thank you.", "you",
  "please subscribe", "like and subscribe", "bye", "[music]", "music", "♪",
]);
function stripHallucination(text: string): string {
  const t = (text || "").trim();
  if (!t) return "";
  const norm = t.toLowerCase().replace(/[\s.,!?"'♪♫🎵🎶()[\]-]+/g, " ").trim();
  return HALLUCINATIONS.has(norm) ? "" : t;
}

// Ensure we have a stored transcript. Returns it from the DB if present (zero cost, no
// vendor call). Otherwise gets the video (preferring our R2 copy), runs Whisper once, and
// persists the result forever. Returns null only if the video can't be obtained yet.
export async function ensureReelTranscript(reelId: number): Promise<string | null> {
  const reel = await loadReel(reelId);
  if (!reel) return null;
  if (reel.transcript !== null && reel.transcript !== undefined) return reel.transcript; // "" is a valid (silent) transcript

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  // Get the bytes — reuse the R2 copy if we have one, else capture now (which also stores it).
  const v = await ensureReelVideo(reelId);
  if (!v.url) return null;
  let bytes = v.bytes;
  if (!bytes) {
    try {
      const r = await fetch(v.url, { headers: { "User-Agent": UA, Referer: "https://www.instagram.com/" }, signal: AbortSignal.timeout(45000) });
      if (!r.ok) return null;
      bytes = Buffer.from(await r.arrayBuffer());
    } catch { return null; }
  }
  // Whisper caps uploads at 25MB. Reels are short so this is rare; if too big we can't
  // extract audio without a media pipeline, so skip transcription (leave transcript null → retry later once we have a smaller source is pointless, so mark empty to avoid loops).
  if (bytes.byteLength > 24 * 1024 * 1024) {
    await (prisma as any).competitorReel.update({ where: { id: reelId }, data: { transcript: "", transcriptAt: new Date(), captureStatus: "done" } }).catch(() => {});
    return "";
  }

  try {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(bytes)], "reel.mp4", { type: "video/mp4" }));
    fd.append("model", "whisper-1");
    const wr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: fd,
      signal: AbortSignal.timeout(90000),
    });
    const result = await wr.json();
    if (!wr.ok) return null; // transient (rate limit etc.) — retry later, don't persist
    const transcript = stripHallucination(result.text || "");
    await (prisma as any).competitorReel.update({
      where: { id: reelId },
      data: { transcript, transcriptAt: new Date(), captureStatus: "done" },
    }).catch(() => {});
    return transcript;
  } catch { return null; }
}

// Full capture for one reel: video → R2, then transcript. Used by the backfill cron and
// lazily on first access. Idempotent — skips whatever's already done.
export async function captureReel(reelId: number): Promise<{ video: boolean; transcript: boolean }> {
  const v = await ensureReelVideo(reelId);
  const t = await ensureReelTranscript(reelId);
  return { video: !!v.permanent, transcript: t !== null };
}
