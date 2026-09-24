// Throwaway spike: renders a 60 s 1080x1920 clip with burned-in ASS captions inside a Vercel
// Function and reports wall time, active CPU and peak RSS of the ffmpeg child process.
// GET /api/render?src=<input url>&preset=veryfast&threads=0
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ffmpegPath = require("ffmpeg-static");

const CLK = 100; // Linux clock ticks per second (sysconf(_SC_CLK_TCK)) on Amazon Linux

function sampleProc(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const hwm = Number((status.match(/VmHWM:\s+(\d+)/) || [])[1] || 0) / 1024;
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
    const cpuS = (Number(stat[11]) + Number(stat[12])) / CLK; // utime + stime
    return { hwmMB: hwm, cpuS };
  } catch { return null; }
}

function run(args) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    let peak = { hwmMB: 0, cpuS: 0 };
    const poll = setInterval(() => { const s = sampleProc(child.pid); if (s) peak = { hwmMB: Math.max(peak.hwmMB, s.hwmMB), cpuS: Math.max(peak.cpuS, s.cpuS) }; }, 100);
    child.on("close", (code) => { clearInterval(poll); resolve({ code, wallS: +((Date.now() - t0) / 1000).toFixed(1), peakRssMB: Math.round(peak.hwmMB), cpuS: +peak.cpuS.toFixed(1), tail: err.split("\n").filter(Boolean).slice(-4) }); });
  });
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const src = url.searchParams.get("src");
  const preset = url.searchParams.get("preset") || "veryfast";
  const threads = url.searchParams.get("threads") || "0";
  const out = { region: process.env.VERCEL_REGION, node: process.version, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemMB: Math.round(os.totalmem() / 1048576), preset, threads };
  try {
    const tDl = Date.now();
    const r = await fetch(src);
    if (!r.ok) throw new Error("download " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync("/tmp/input.mp4", buf);
    out.inputMB = +(buf.length / 1048576).toFixed(1);
    out.downloadS = +((Date.now() - tDl) / 1000).toFixed(1);
    const cap = await fetch(new URL("/captions.ass", src)).then((x) => x.text());
    fs.writeFileSync("/tmp/captions.ass", cap);
    const fontsDir = path.join(process.cwd(), "fonts");
    out.fontsDirExists = fs.existsSync(path.join(fontsDir, "Roboto-Bold.ttf"));
    const args = ["-hide_banner", "-y", ...(threads !== "0" ? ["-threads", threads] : []), "-i", "/tmp/input.mp4", "-vf", `subtitles=filename=/tmp/captions.ass:fontsdir=${fontsDir}`, "-c:v", "libx264", "-preset", preset, "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "copy", ...(threads !== "0" ? ["-threads", threads] : []), "/tmp/out.mp4"];
    out.render = await run(args);
    out.outMB = fs.existsSync("/tmp/out.mp4") ? +(fs.statSync("/tmp/out.mp4").size / 1048576).toFixed(1) : null;
    // Verify the output decodes end to end (frame count) — ffmpeg-static has no ffprobe.
    const v = await run(["-hide_banner", "-i", "/tmp/out.mp4", "-map", "0:v", "-f", "null", "-"]);
    out.verify = { code: v.code, tail: v.tail.filter((l) => /frame=|Duration/.test(l)) };
    out.functionRssMB = Math.round(process.memoryUsage().rss / 1048576);
    out.ok = out.render.code === 0 && !!out.outMB;
  } catch (e) {
    out.ok = false; out.error = String(e && e.stack || e);
  } finally {
    for (const f of ["/tmp/input.mp4", "/tmp/out.mp4", "/tmp/captions.ass"]) fs.rmSync(f, { force: true });
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(out, null, 2));
};
