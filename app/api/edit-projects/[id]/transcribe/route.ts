import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/shared/db/prisma";
import { uploadToR2 } from "@/shared/media/r2";
import { stripHallucination } from "@/features/instagram/server/reelCapture";
import { getProject } from "@/features/editor/server/projects";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";
import { RENDER_LIMITS } from "@/features/editor/server/executor";
import type { AssetTranscript, TranscriptWord } from "@/features/editor/model/document";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/edit-projects/:id/transcribe  { assetIds: string[], force?: boolean }
// Word-timed transcription of the project's clips for auto-captions:
//   1. audio is extracted SERVER-SIDE with ffmpeg reading the clip straight from R2 (a presigned
//      GET on the S3 endpoint): the sources are 4K uploads of 300–900 MB, far past anything a
//      browser should hold in ffmpeg.wasm memory or send to Whisper (25 MB cap); only the mono
//      16 kHz 32 kbps MP3 (~4 KB per second of speech) ever leaves ffmpeg;
//   2. Whisper (whisper-1) with response_format=verbose_json and timestamp_granularities[]=word,
//      the client's language, and the draft's hook+script as the vocabulary prompt;
//   3. the result is cached in R2 under transcripts/<sha1(url|language|model)>.json, so a second
//      run, a re-layout, another project using the same footage, or a reload never pays twice.
// Ceiling: the editor's 15-minute timeline (RENDER_LIMITS); above it the request is refused.
const CACHE_VERSION = "v1";
const MODEL = "whisper-1";
const MAX_TMP_BYTES = 450 * 1024 * 1024; // /tmp on a Vercel function is 500 MB

type Whisper = { text?: string; words?: { word: string; start: number; end: number }[]; segments?: { start: number; end: number; text: string }[] };

function s3() {
  return new S3Client({ region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
}
function r2Key(url: string): string | null {
  const base = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base && url.startsWith(base + "/") ? decodeURIComponent(url.slice(base.length + 1).split("?")[0]) : null;
}
async function readCache(client: S3Client, key: string): Promise<TranscriptWord[] | null> {
  try {
    const r = await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
    const text = await r.Body?.transformToString();
    const j = text ? JSON.parse(text) : null;
    return Array.isArray(j?.words) ? j.words : null;
  } catch { return null; }
}

function run(bin: string, args: string[], maxStdout: number): Promise<{ code: number | null; out: Buffer; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let size = 0; let err = "";
    p.stdout.on("data", (d: Buffer) => { size += d.length; if (size <= maxStdout) chunks.push(d); else p.kill(); });
    p.stderr.on("data", (d: Buffer) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
    p.on("close", (code) => resolve({ code, out: Buffer.concat(chunks), err }));
    p.on("error", (e) => resolve({ code: -1, out: Buffer.alloc(0), err: String(e) }));
  });
}

/** Mono 16 kHz 32 kbps MP3 of the clip's audio track; reads the signed url directly, and if this
 *  ffmpeg build cannot speak https, downloads to /tmp first (size permitting). */
async function extractAudio(signedUrl: string, id: string): Promise<{ audio: Buffer; how: "stream" | "tmp" }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpeg = require("ffmpeg-static") as string;
  const AUDIO_ARGS = ["-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "mp3", "pipe:1"];
  const MAX_AUDIO = 25 * 1024 * 1024; // Whisper's cap
  const first = await run(ffmpeg, ["-nostdin", "-loglevel", "error", "-i", signedUrl, ...AUDIO_ARGS], MAX_AUDIO);
  if (first.code === 0 && first.out.length > 0) return { audio: first.out, how: "stream" };
  const head = await fetch(signedUrl, { method: "HEAD" });
  const bytes = Number(head.headers.get("content-length") || 0);
  if (!bytes || bytes > MAX_TMP_BYTES) throw new Error(`ffmpeg could not read the clip over https (${first.err.trim().split("\n").pop() || "no detail"}) and it is ${bytes ? Math.round(bytes / 1048576) + " MB" : "of unknown size"}, over the ${MAX_TMP_BYTES / 1048576} MB that can be staged on the server`);
  const tmp = path.join(os.tmpdir(), `edit-${id}-${Date.now()}.mp4`);
  try {
    const r = await fetch(signedUrl);
    if (!r.ok || !r.body) throw new Error(`download ${r.status}`);
    await fs.promises.writeFile(tmp, r.body as unknown as NodeJS.ReadableStream);
    const second = await run(ffmpeg, ["-nostdin", "-loglevel", "error", "-i", tmp, ...AUDIO_ARGS], MAX_AUDIO);
    if (second.code !== 0 || second.out.length === 0) throw new Error(`ffmpeg failed: ${second.err.trim().split("\n").pop() || second.code}`);
    return { audio: second.out, how: "tmp" };
  } finally {
    fs.promises.rm(tmp, { force: true }).catch(() => {});
  }
}

async function whisper(audio: Buffer, language: string | null, prompt: string | null): Promise<TranscriptWord[]> {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "audio.mp3");
  fd.append("model", MODEL);
  fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "word");
  fd.append("timestamp_granularities[]", "segment");
  if (language) fd.append("language", language);
  if (prompt) fd.append("prompt", prompt);
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd, signal: AbortSignal.timeout(240000) });
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as Whisper;
  // Segments Whisper tends to invent over silence ("thanks for watching", "you") take their words with them.
  const bad = (j.segments || []).filter((s) => stripHallucination(s.text) === "").map((s) => [s.start, s.end] as const);
  return (j.words || [])
    .filter((w) => w.word && w.word.trim() && !bad.some(([a, b]) => (w.start + w.end) / 2 >= a && (w.start + w.end) / 2 <= b))
    .map((w) => ({ text: w.word.trim(), startMs: Math.round(w.start * 1000), endMs: Math.max(Math.round(w.start * 1000) + 50, Math.round(w.end * 1000)) }));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "transcription not configured" }, { status: 500 });
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_BUCKET || !process.env.R2_PUBLIC_BASE_URL) return NextResponse.json({ error: "R2 not configured" }, { status: 500 });
  const { id } = await params;
  const project = await getProject(parseInt(id, 10));
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, project.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;
  const wanted: string[] = Array.isArray(body?.assetIds) ? body.assetIds.filter((x: unknown) => typeof x === "string") : [];
  const assets = project.document.assets.filter((a) => wanted.includes(a.id) && a.kind === "video");
  if (assets.length === 0) return NextResponse.json({ error: "no clips to transcribe" }, { status: 400 });
  const totalMs = assets.reduce((s, a) => s + (a.durationMs ?? 0), 0);
  if (totalMs > RENDER_LIMITS.MAX_TIMELINE_MS) {
    return NextResponse.json({ error: `These clips add up to ${Math.round(totalMs / 60000)} min of audio; the ceiling is ${RENDER_LIMITS.MAX_TIMELINE_MS / 60000} min per project. Trim the main track first.` }, { status: 422 });
  }

  const draft = await prisma.scriptDraft.findUnique({ where: { id: project.draftId }, select: { hook: true, script: true, client: { select: { language: true } } } });
  const language = draft?.client.language && /^[a-z]{2}$/i.test(draft.client.language) ? draft.client.language.toLowerCase() : null;
  const scriptText = [draft?.hook, draft?.script].filter((s) => s && s.trim()).join("\n") || null;
  // Whisper's prompt is a vocabulary hint (≈224 tokens): the script's first ~150 words carry the jargon and names.
  const prompt = scriptText ? scriptText.replace(/\s+/g, " ").split(" ").slice(0, 150).join(" ") : null;

  const client = s3();
  const out: AssetTranscript[] = [];
  const cached: string[] = [];
  const how: Record<string, string> = {};
  for (const a of assets) {
    const key = r2Key(a.url);
    if (!key) return NextResponse.json({ error: `${a.name} is not stored in R2; only uploaded clips can be transcribed` }, { status: 422 });
    const cacheKey = `transcripts/${createHash("sha1").update(`${a.url}|${language ?? ""}|${MODEL}|${CACHE_VERSION}`).digest("hex")}.json`;
    const hit = force ? null : await readCache(client, cacheKey);
    if (hit) { out.push({ assetId: a.id, url: a.url, language, words: hit }); cached.push(a.id); continue; }
    try {
      const signed = await getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }), { expiresIn: 1800 });
      const { audio, how: h } = await extractAudio(signed, `${project.id}-${a.id}`);
      how[a.id] = `${h}:${Math.round(audio.length / 1024)}kB`;
      const words = await whisper(audio, language, prompt);
      await uploadToR2(cacheKey, Buffer.from(JSON.stringify({ url: a.url, language, model: MODEL, createdAt: new Date().toISOString(), words })), "application/json");
      out.push({ assetId: a.id, url: a.url, language, words });
    } catch (e) {
      return NextResponse.json({ error: `${a.name}: ${e instanceof Error ? e.message : String(e)}`, partial: out }, { status: 502 });
    }
  }
  return NextResponse.json({ assets: out, cached, how, language, script: scriptText });
}
