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
export const maxDuration = 300;

// GET /api/edit-projects/:id/filmstrip?assetId=<id> — the timeline's filmstrip for one clip, as a
// single sprite sheet made once per asset and cached in R2. ffmpeg decodes KEYFRAMES ONLY
// (-skip_frame nokey): a full decode of an 8-minute 4K 10-bit HEVC clip measured 466 s against
// 42 s for keyframes, and phone footage keeps a keyframe every ~1 s, which is finer than the
// 31 px cell at every zoom level we ship. Each cell is the last keyframe at or before its slot
// (fps=1/interval, round=down), 31×43, tiled 24 per row. The browser never decodes video for
// this: it draws cells straight from the sprite, so it cannot compete with playback.
const VERSION = "v1";
const CELL_W = 31, CELL_H = 43, COLS = 24, MAX_CELLS = 480;
const MAX_JPEG = 8 * 1024 * 1024;
const MAX_TMP_BYTES = 450 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 240_000;

type Meta = { v: string; interval: number; cols: number; rows: number; count: number; cellW: number; cellH: number };

function spriteArgs(input: string, m: Meta): string[] {
  return ["-nostdin", "-loglevel", "error", "-skip_frame", "nokey", "-i", input,
    "-vf", `fps=1/${m.interval}:round=down,scale=${m.cellW}:${m.cellH}:force_original_aspect_ratio=increase,crop=${m.cellW}:${m.cellH},tile=${m.cols}x${m.rows}`,
    // 4:4:4 so the odd 31×43 cells are not rounded to even sizes by chroma subsampling (measured: 30×42 without it).
    "-frames:v", "1", "-q:v", "5", "-pix_fmt", "yuvj444p", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"];
}

async function makeSprite(signedUrl: string, id: string, m: Meta): Promise<Buffer> {
  const ffmpeg = ffmpegPath();
  const first = await run(ffmpeg, spriteArgs(signedUrl, m), MAX_JPEG, FFMPEG_TIMEOUT_MS);
  if (first.code === 0 && first.out.length > 0) return first.out;
  if (first.timedOut) throw new Error(`ffmpeg exceeded ${FFMPEG_TIMEOUT_MS / 1000} s reading the clip over https`);
  const head = await fetch(signedUrl, { method: "HEAD" });
  const bytes = Number(head.headers.get("content-length") || 0);
  if (!bytes || bytes > MAX_TMP_BYTES) throw new Error(`ffmpeg could not read the clip over https (${first.err.trim().split("\n").pop() || first.code}) and it is too large to stage (${Math.round(bytes / 1048576)} MB)`);
  const tmp = path.join(os.tmpdir(), `strip-${id}-${Date.now()}.mp4`);
  try {
    const r = await fetch(signedUrl);
    if (!r.ok || !r.body) throw new Error(`download ${r.status}`);
    await fs.promises.writeFile(tmp, r.body as unknown as NodeJS.ReadableStream);
    const second = await run(ffmpeg, spriteArgs(tmp, m), MAX_JPEG, FFMPEG_TIMEOUT_MS);
    if (second.code !== 0 || second.out.length === 0) throw new Error(`ffmpeg failed: ${second.err.trim().split("\n").pop() || second.code}`);
    return second.out;
  } finally {
    fs.promises.rm(tmp, { force: true }).catch(() => {});
  }
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
  if (!asset.durationMs) return NextResponse.json({ error: "clip length unknown yet" }, { status: 422 });
  const client = s3();
  const bucket = process.env.R2_BUCKET!;
  const base = `filmstrips/${createHash("sha1").update(asset.url).digest("hex")}.${VERSION}`;
  const started = Date.now();
  try {
    const cached = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${base}.json` })).then((r) => r.Body?.transformToString()).catch(() => null);
    let meta: Meta | null = cached ? (JSON.parse(cached) as Meta) : null;
    let how = "cache";
    if (!meta) {
      const seconds = asset.durationMs / 1000;
      const interval = Math.max(1, Math.ceil(seconds / MAX_CELLS));
      const count = Math.max(1, Math.min(MAX_CELLS, Math.ceil(seconds / interval)));
      meta = { v: VERSION, interval, cols: COLS, rows: Math.ceil(count / COLS), count, cellW: CELL_W, cellH: CELL_H };
      const signed = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 1800 });
      const jpeg = await makeSprite(signed, `${project.id}-${asset.id}`, meta);
      const put = await uploadToR2(`${base}.jpg`, jpeg, "image/jpeg");
      if (!put) throw new Error("could not store the sprite in R2");
      await uploadToR2(`${base}.json`, Buffer.from(JSON.stringify(meta)), "application/json");
      how = `ffmpeg ${jpeg.length} bytes`;
    }
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: `${base}.jpg` }), { expiresIn: 3600 });
    console.log(`[filmstrip] project ${project.id} asset ${asset.id}: ${how}, ${meta.count} cells @ ${meta.interval}s, ${Date.now() - started} ms`);
    return NextResponse.json({ ...meta, url }, { headers: { "Cache-Control": "private, max-age=1800" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[filmstrip] project ${project.id} asset ${asset.id} failed after ${Date.now() - started} ms: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
