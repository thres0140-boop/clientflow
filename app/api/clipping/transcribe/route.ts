import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { canEditPage } from "@/shared/auth/permissions";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";
import { r2Key, readCachedTranscript, s3, transcribeR2Object, transcriptCacheKey, transcriptionConfigured, whisperLanguage, whisperPrompt } from "@/features/editor/server/transcribe";

export const runtime = "nodejs";
export const maxDuration = 300;

// Whisper takes 25 MB of audio; at the 32 kbps MP3 the extractor writes that is ~104 minutes.
// 60 keeps a margin for the function's 300 s (streaming a multi-GB master through ffmpeg plus
// the Whisper round trip both scale with length).
export const MAX_SOURCE_MS = 60 * 60 * 1000;

// POST /api/clipping/transcribe  { draftId, url, durationMs?, cacheOnly?, force? }
// Word-timed transcript of a long-form YouTube video (the draft's finished video or a raw upload),
// cached in R2 under the same key the editor uses, so every clip cut from it gets its captions
// from the cache. `cacheOnly` answers { words: null } instead of paying for a run.
export async function POST(req: NextRequest) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const draftId = parseInt(String(body?.draftId ?? ""), 10);
  const url = typeof body?.url === "string" ? body.url : "";
  if (!Number.isFinite(draftId) || !url) return NextResponse.json({ error: "draftId and url required" }, { status: 400 });
  const draft = await prisma.scriptDraft.findUnique({ where: { id: draftId }, select: { clientId: true, hook: true, script: true, rawContentUrls: true, editedVideoUrl: true, client: { select: { language: true } } } });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, draft.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // The url must be one of this draft's videos, never an arbitrary object.
  let raw: string[] = [];
  try { raw = JSON.parse(draft.rawContentUrls || "[]"); } catch { raw = []; }
  if (url !== draft.editedVideoUrl && !raw.includes(url)) return NextResponse.json({ error: "that video does not belong to this draft" }, { status: 400 });
  const notConfigured = transcriptionConfigured();
  if (notConfigured) return NextResponse.json({ error: notConfigured }, { status: 500 });
  const key = r2Key(url);
  if (!key) return NextResponse.json({ error: "This video is not stored in R2, so it cannot be transcribed here. Clips can still be cut; their captions will come from Whisper in the editor." }, { status: 422 });

  const language = whisperLanguage(draft.client.language);
  const client = s3();
  const hit = body?.force === true ? null : await readCachedTranscript(client, transcriptCacheKey(url, language));
  if (hit) return NextResponse.json({ words: hit, language, cached: true });
  if (body?.cacheOnly === true) return NextResponse.json({ words: null, language, cached: false });

  if (!(await canEditPage(req, "ytclipping"))) return NextResponse.json({ error: "You have view-only access to Clipping." }, { status: 403 });
  const durationMs = Number(body?.durationMs || 0);
  if (durationMs > MAX_SOURCE_MS) return NextResponse.json({ error: `This video is ${Math.round(durationMs / 60000)} min long; the ceiling is ${MAX_SOURCE_MS / 60000} min.` }, { status: 422 });
  try {
    const r = await transcribeR2Object(client, url, key, language, whisperPrompt(draft.hook, draft.script), `clip-${draftId}`);
    return NextResponse.json({ words: r.words, language, cached: false, how: r.how });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
