import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { getProject } from "@/features/editor/server/projects";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";
import { RENDER_LIMITS } from "@/features/editor/server/executor";
import { r2Key, readCachedTranscript, s3, transcribeR2Object, transcriptCacheKey, transcriptionConfigured, TranscribeTimeoutError, whisperLanguage, whisperPrompt } from "@/features/editor/server/transcribe";
import type { AssetTranscript } from "@/features/editor/model/document";

export const runtime = "nodejs";
export const maxDuration = 300;
// One budget for the whole request (all assets), inside maxDuration, so a slow step answers with
// a clear message instead of the platform killing the function.
const BUDGET_MS = 280_000;

// POST /api/edit-projects/:id/transcribe  { assetIds: string[], force?: boolean }
// Word-timed transcription of the project's clips for auto-captions. The extraction, Whisper
// call and R2 cache live in features/editor/server/transcribe.ts (shared with Clipping).
// Ceiling: the editor's 15-minute timeline (RENDER_LIMITS), applied per asset and only when the
// asset is NOT already in the cache. A clip cut from a long-form video on the Clipping page
// carries the whole source as its asset, but its transcript was made (and cached) there, so it
// must never be refused for the source's length.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const notConfigured = transcriptionConfigured();
  if (notConfigured) return NextResponse.json({ error: notConfigured }, { status: 500 });
  const { id } = await params;
  const project = await getProject(parseInt(id, 10));
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, project.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;
  const wanted: string[] = Array.isArray(body?.assetIds) ? body.assetIds.filter((x: unknown) => typeof x === "string") : [];
  const assets = project.document.assets.filter((a) => wanted.includes(a.id) && a.kind === "video");
  if (assets.length === 0) return NextResponse.json({ error: "no clips to transcribe" }, { status: 400 });

  const draft = await prisma.scriptDraft.findUnique({ where: { id: project.draftId }, select: { hook: true, script: true, client: { select: { language: true } } } });
  const language = whisperLanguage(draft?.client.language);
  const scriptText = [draft?.hook, draft?.script].filter((s) => s && s.trim()).join("\n") || null;
  const prompt = whisperPrompt(draft?.hook, draft?.script);

  const client = s3();
  const deadlineAt = Date.now() + BUDGET_MS;
  const out: AssetTranscript[] = [];
  const cached: string[] = [];
  const how: Record<string, string> = {};
  let uncachedMs = 0;
  for (const a of assets) {
    const key = r2Key(a.url);
    if (!key) return NextResponse.json({ error: `${a.name} is not stored in R2; only uploaded clips can be transcribed` }, { status: 422 });
    const hit = force ? null : await readCachedTranscript(client, transcriptCacheKey(a.url, language));
    if (hit) { out.push({ assetId: a.id, url: a.url, language, words: hit }); cached.push(a.id); continue; }
    uncachedMs += a.durationMs ?? 0;
    if (uncachedMs > RENDER_LIMITS.MAX_TIMELINE_MS) {
      return NextResponse.json({ error: `${a.name} is ${Math.round((a.durationMs ?? 0) / 60000)} min long; the ceiling for a fresh transcription here is ${RENDER_LIMITS.MAX_TIMELINE_MS / 60000} min. A long-form video is transcribed on the Clipping page, after which its clips use that transcript.` }, { status: 422 });
    }
    try {
      const r = await transcribeR2Object(client, a.url, key, language, prompt, `${project.id}-${a.id}`, deadlineAt);
      how[a.id] = r.how;
      out.push({ assetId: a.id, url: a.url, language, words: r.words });
    } catch (e) {
      if (e instanceof TranscribeTimeoutError) return NextResponse.json({ error: `${a.name}: ${e.message}`, timedOut: true, step: e.step, partial: out }, { status: 504 });
      return NextResponse.json({ error: `${a.name}: ${e instanceof Error ? e.message : String(e)}`, partial: out }, { status: 502 });
    }
  }
  return NextResponse.json({ assets: out, cached, how, language, script: scriptText });
}
