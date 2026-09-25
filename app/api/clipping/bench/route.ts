import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isAdminToken } from "@/shared/auth/adminToken";
import { AUDIO_ARGS, extractAudio, ffmpegPath, r2Key, run, s3, TranscribeTimeoutError, transcriptionConfigured, whisper } from "@/features/editor/server/transcribe";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET /api/clipping/bench?token=<ADMIN_TOKEN>&url=<R2 public url>[&mode=probe|extract|full][&language=nl]
// Measures, on the real function against a real object, where transcription's ceiling is:
//   probe   (default, cheap, ~15 s) — HEAD size; download throughput over the first 64 MB;
//           the container's duration/bitrate from ffmpeg's header read; ffmpeg reading the first
//           two minutes of audio (which is how fast it demuxes the file, network included).
//           Answers with a prediction for the full extraction.
//   extract — the real thing: the whole audio track, timed, inside the same budget the
//           transcribe route uses. No Whisper, no cache write, nothing paid.
//   full    — extract + Whisper (paid; the result is NOT cached).
// Admin-token guarded like /api/admin/migrate; writes nothing.
const BUDGET_MS = 280_000;
const PROBE_BYTES = 64 * 1024 * 1024;

function parseHeader(err: string): { durationMs: number | null; bitrateKbps: number | null } {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  const b = /bitrate:\s*(\d+)\s*kb\/s/.exec(err);
  return {
    durationMs: d ? Math.round((Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 1000) : null,
    bitrateKbps: b ? Number(b[1]) : null,
  };
}

export async function GET(req: NextRequest) {
  if (!isAdminToken(req.nextUrl.searchParams.get("token"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const notConfigured = transcriptionConfigured();
  if (notConfigured) return NextResponse.json({ error: notConfigured }, { status: 500 });
  const url = req.nextUrl.searchParams.get("url") || "";
  const key = r2Key(url);
  if (!key) return NextResponse.json({ error: "url must be one of our R2 public urls" }, { status: 400 });
  const mode = req.nextUrl.searchParams.get("mode") || "probe";
  const language = req.nextUrl.searchParams.get("language") || null;
  const started = Date.now();
  const out: Record<string, unknown> = { mode, key };

  const client = s3();
  const signed = await getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }), { expiresIn: 1800 });
  const head = await fetch(signed, { method: "HEAD" });
  const bytes = Number(head.headers.get("content-length") || 0);
  out.file = { bytes, mb: Math.round(bytes / 1048576), contentType: head.headers.get("content-type") };

  if (mode === "probe") {
    // 1. Raw download throughput, first 64 MB.
    const t0 = Date.now();
    const r = await fetch(signed, { headers: { Range: `bytes=0-${Math.min(bytes, PROBE_BYTES) - 1}` } });
    let got = 0;
    if (r.body) { const reader = r.body.getReader(); for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.byteLength; } }
    const dlMs = Date.now() - t0;
    const mbps = got / 1048576 / (dlMs / 1000);
    out.download = { mb: Math.round(got / 1048576), ms: dlMs, mbPerSec: Math.round(mbps * 10) / 10, status: r.status };

    // 2. Container header: duration and overall bitrate.
    const ffmpeg = ffmpegPath();
    const hdr = await run(ffmpeg, ["-nostdin", "-hide_banner", "-i", signed], 1024, 30_000);
    const info = parseHeader(hdr.err);
    out.container = { ...info, minutes: info.durationMs ? Math.round(info.durationMs / 6000) / 10 : null };

    // 3. ffmpeg demuxing the first two minutes of audio over https (network + demux + decode + mp3).
    const t1 = Date.now();
    const two = await run(ffmpeg, ["-nostdin", "-loglevel", "error", "-i", signed, "-t", "120", ...AUDIO_ARGS], 8 * 1024 * 1024, 120_000);
    const twoMs = Date.now() - t1;
    const bytesFor2min = info.bitrateKbps ? (info.bitrateKbps * 1000 / 8) * 120 : null;
    out.probe2min = { ms: twoMs, code: two.code, timedOut: two.timedOut, audioKB: Math.round(two.out.length / 1024), approxBytesRead: bytesFor2min ? Math.round(bytesFor2min / 1048576) + " MB" : null, err: two.err.trim().split("\n").pop() || null };

    // 4. Prediction for the whole file at the demux rate just measured (and at the raw download
    //    rate as a lower bound), against the transcribe route's budget.
    if (info.durationMs && two.code === 0 && twoMs > 0) {
      const perSecOfVideo = twoMs / 120;
      const predictedExtractMs = Math.round(perSecOfVideo * (info.durationMs / 1000));
      const lowerBoundMs = mbps > 0 ? Math.round((bytes / 1048576 / mbps) * 1000) : null;
      const extractBudgetMs = BUDGET_MS - 90_000;
      out.prediction = {
        extractMs_atDemuxRate: predictedExtractMs,
        extractMs_atDownloadRate: lowerBoundMs,
        extractBudgetMs,
        fitsBudget_atDemuxRate: predictedExtractMs <= extractBudgetMs,
        maxMinutesAtDemuxRate: Math.round((extractBudgetMs / perSecOfVideo) / 60 * 10) / 10,
        maxMbAtDownloadRate: mbps > 0 ? Math.round((extractBudgetMs / 1000) * mbps) : null,
        note: "Whisper is budgeted separately (90 s reserve); historically ~1 s per minute of audio.",
      };
    }
    out.totalMs = Date.now() - started;
    return NextResponse.json(out);
  }

  // extract | full
  try {
    const t0 = Date.now();
    const { audio, how } = await extractAudio(signed, `bench-${Date.now()}`, started + BUDGET_MS - (mode === "full" ? 90_000 : 0));
    out.extract = { ms: Date.now() - t0, how, audioKB: Math.round(audio.length / 1024) };
    if (mode === "full") {
      const t1 = Date.now();
      const words = await whisper(audio, language, null, Math.min(240_000, started + BUDGET_MS - Date.now()));
      out.whisper = { ms: Date.now() - t1, words: words.length, lastWordAtMs: words[words.length - 1]?.endMs ?? null };
    }
  } catch (e) {
    if (e instanceof TranscribeTimeoutError) { out.timedOut = { step: e.step, elapsedMs: e.elapsedMs, message: e.message }; }
    else out.error = e instanceof Error ? e.message : String(e);
  }
  out.totalMs = Date.now() - started;
  return NextResponse.json(out);
}
