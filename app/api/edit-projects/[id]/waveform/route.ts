import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadToR2 } from "@/shared/media/r2";
import { getProject } from "@/features/editor/server/projects";
import { mayAccessClient, sessionFrom } from "@/features/editor/server/access";
import { ffmpegPath, r2Key, run, s3 } from "@/features/editor/server/transcribe";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET /api/edit-projects/:id/waveform?assetId=<id> — waveform peaks for one clip, for the timeline's
// clip blocks. ffmpeg reads the clip straight from R2 (presigned GET) and emits 4 kHz mono 16-bit
// PCM; each 80-sample window (20 ms) becomes one peak byte, so a 90 s reel is 4,500 bytes. Cached
// in R2 under waveforms/<sha1(url)>.<version>.json, so every asset pays the extraction once.
// Decoding in the browser was rejected: it would mean holding the whole 4K file in memory.
const VERSION = "v1";
const RATE = 4000;
const WINDOW = 80; // → 50 peaks per second
const MAX_PCM = 64 * 1024 * 1024; // 4 kHz s16 mono: 64 MB is ~2.3 h, far beyond the 15-minute ceiling
const MAX_TMP_BYTES = 450 * 1024 * 1024;

async function extractPcm(signedUrl: string, id: string): Promise<Buffer> {
  const ffmpeg = ffmpegPath();
  const ARGS = ["-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "pipe:1"];
  const first = await run(ffmpeg, ["-nostdin", "-loglevel", "error", "-i", signedUrl, ...ARGS], MAX_PCM, 100_000);
  if (first.code === 0 && first.out.length > 0) return first.out;
  const head = await fetch(signedUrl, { method: "HEAD" });
  const bytes = Number(head.headers.get("content-length") || 0);
  if (!bytes || bytes > MAX_TMP_BYTES) throw new Error(`ffmpeg could not read the clip over https and it is too large to stage (${Math.round(bytes / 1048576)} MB)`);
  const tmp = path.join(os.tmpdir(), `wave-${id}-${Date.now()}.mp4`);
  try {
    const r = await fetch(signedUrl);
    if (!r.ok || !r.body) throw new Error(`download ${r.status}`);
    await fs.promises.writeFile(tmp, r.body as unknown as NodeJS.ReadableStream);
    const second = await run(ffmpeg, ["-nostdin", "-loglevel", "error", "-i", tmp, ...ARGS], MAX_PCM, 100_000);
    if (second.code !== 0 || second.out.length === 0) throw new Error(`ffmpeg failed: ${second.err.trim().split("\n").pop() || second.code}`);
    return second.out;
  } finally {
    fs.promises.rm(tmp, { force: true }).catch(() => {});
  }
}

function peaksOf(pcm: Buffer): Uint8Array {
  const samples = pcm.length >> 1;
  const out = new Uint8Array(Math.ceil(samples / WINDOW));
  for (let w = 0; w < out.length; w++) {
    let max = 0;
    const end = Math.min(samples, (w + 1) * WINDOW);
    for (let i = w * WINDOW; i < end; i++) { const v = Math.abs(pcm.readInt16LE(i * 2)); if (v > max) max = v; }
    out[w] = Math.min(255, Math.round((max / 32768) * 255));
  }
  return out;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFrom(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_BUCKET || !process.env.R2_PUBLIC_BASE_URL) return NextResponse.json({ error: "R2 not configured" }, { status: 500 });
  const { id } = await params;
  const project = await getProject(parseInt(id, 10));
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mayAccessClient(session, project.clientId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const assetId = req.nextUrl.searchParams.get("assetId") || "";
  const asset = project.document.assets.find((a) => a.id === assetId);
  if (!asset) return NextResponse.json({ error: "no such asset" }, { status: 404 });
  const key = r2Key(asset.url);
  if (!key) return NextResponse.json({ error: "not an R2 clip" }, { status: 422 });
  const client = s3();
  const cacheKey = `waveforms/${createHash("sha1").update(asset.url).digest("hex")}.${VERSION}.json`;
  try {
    const hit = await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: cacheKey })).then((r) => r.Body?.transformToString()).catch(() => null);
    if (hit) return new NextResponse(hit, { headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" } });
    const signed = await getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }), { expiresIn: 1800 });
    const pcm = await extractPcm(signed, `${project.id}-${asset.id}`);
    const body = JSON.stringify({ rate: RATE / WINDOW, peaks: Buffer.from(peaksOf(pcm)).toString("base64") });
    await uploadToR2(cacheKey, Buffer.from(body), "application/json").catch(() => null);
    return new NextResponse(body, { headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
