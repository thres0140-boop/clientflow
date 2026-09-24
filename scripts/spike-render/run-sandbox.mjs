// Option D measurement on Vercel Sandbox (a Firecracker microVM, i.e. a dedicated render box).
//   node run-sandbox.mjs <vcpus> [preset]
import { Sandbox } from "@vercel/sandbox";
import fs from "node:fs";
import os from "node:os";

// Runs inside the sandbox: spawn ffmpeg, poll /proc for peak RSS + CPU time, verify the output.
const MEASURE = String.raw`
const { spawn } = require("node:child_process"); const fs = require("node:fs");
const preset = process.argv[2] || "veryfast";
function sample(pid){ try { const st=fs.readFileSync("/proc/"+pid+"/status","utf8"); const hwm=Number((st.match(/VmHWM:\s+(\d+)/)||[])[1]||0)/1024; const s=fs.readFileSync("/proc/"+pid+"/stat","utf8").split(") ")[1].split(" "); return {hwmMB:hwm,cpuS:(Number(s[11])+Number(s[12]))/100}; } catch { return null; } }
function run(args){ return new Promise((resolve)=>{ const t0=Date.now(); const c=spawn("./ffmpeg",args,{stdio:["ignore","ignore","pipe"]}); let err=""; c.stderr.on("data",d=>{err+=d; if(err.length>20000) err=err.slice(-20000);}); let peak={hwmMB:0,cpuS:0}; const p=setInterval(()=>{const s=sample(c.pid); if(s) peak={hwmMB:Math.max(peak.hwmMB,s.hwmMB),cpuS:Math.max(peak.cpuS,s.cpuS)};},100); c.on("close",code=>{clearInterval(p); resolve({code,wallS:+((Date.now()-t0)/1000).toFixed(1),peakRssMB:Math.round(peak.hwmMB),cpuS:+peak.cpuS.toFixed(1),tail:err.split("\n").filter(Boolean).slice(-3)});}); }); }
(async()=>{ const r=await run(["-hide_banner","-y","-i","input.mp4","-vf","subtitles=filename=captions.ass:fontsdir=fonts","-c:v","libx264","-preset",preset,"-crf","23","-pix_fmt","yuv420p","-c:a","copy","out.mp4"]);
  r.outMB = fs.existsSync("out.mp4") ? +(fs.statSync("out.mp4").size/1048576).toFixed(1) : null;
  const v = await run(["-hide_banner","-i","out.mp4","-map","0:v","-f","null","-"]); r.verify={code:v.code,tail:v.tail.filter(l=>/frame=/.test(l))};
  console.log(JSON.stringify(r)); })();
`;

const vcpus = Number(process.argv[2] || 2);
const preset = process.argv[3] || "veryfast";
const token = JSON.parse(fs.readFileSync(`${os.homedir()}/Library/Application Support/com.vercel.cli/auth.json`, "utf8")).token;
const teamId = "team_9xkCZM4lqbmqmEiy3zrH0ovL";
const projectId = "prj_Qel42bZ048pDsDyByTQwdc9rymfd";
const name = `sandbox-${vcpus}vcpu-${preset}`;
const out = { name, vcpus, preset };
const t0 = Date.now();

const sandbox = await Sandbox.create({ token, teamId, projectId, image: "vercel/sandbox/universal", resources: { vcpus }, timeout: 15 * 60 * 1000 });
out.createS = +((Date.now() - t0) / 1000).toFixed(1);
console.log("sandbox up", sandbox.sandboxId, "in", out.createS, "s");
try {
  const tUp = Date.now();
  await sandbox.writeFiles([
    { path: "/vercel/sandbox/input.mp4", content: fs.readFileSync("media/input.mp4") },
    { path: "/vercel/sandbox/captions.ass", content: fs.readFileSync("media/captions.ass") },
    { path: "/vercel/sandbox/fonts/Roboto-Bold.ttf", content: fs.readFileSync("fonts/Roboto-Bold.ttf") },
    { path: "/vercel/sandbox/measure.js", content: Buffer.from(MEASURE) },
  ]);
  out.uploadS = +((Date.now() - tUp) / 1000).toFixed(1);

  const tFf = Date.now();
  // Static ffmpeg build with libass (same family as ffmpeg-static on npm). Downloads into a sandbox are free.
  const inst = await sandbox.runCommand("bash", ["-c", "cd /vercel/sandbox && curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar xJ && mv ffmpeg-*-static/ffmpeg ./ffmpeg && ./ffmpeg -version | head -1 && nproc && free -m | head -2"]);
  out.ffmpegInstallS = +((Date.now() - tFf) / 1000).toFixed(1);
  out.env = (await inst.stdout()).trim().split("\n");
  if (inst.exitCode !== 0) throw new Error("ffmpeg install failed: " + (await inst.stderr()));

  const run = await sandbox.runCommand("bash", ["-c", "cd /vercel/sandbox && node measure.js " + preset + " 2>&1; echo EXIT=$?"]);
  const stdout = await run.stdout();
  out.measureStderr = (await run.stderr()).slice(-1500);
  out.measureExit = run.exitCode;
  out.rawTail = stdout.trim().split("\n").slice(-12);
  const jsonLine = stdout.trim().split("\n").reverse().find((l) => l.startsWith("{"));
  out.measure = jsonLine ? JSON.parse(jsonLine) : { code: -1 };
  out.ok = run.exitCode === 0 && out.measure.code === 0;
} catch (e) {
  out.ok = false; out.error = String(e && e.stack || e);
} finally {
  await sandbox.stop().catch(() => {});
}
out.totalS = +((Date.now() - t0) / 1000).toFixed(1);
fs.writeFileSync(`results/${name}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

