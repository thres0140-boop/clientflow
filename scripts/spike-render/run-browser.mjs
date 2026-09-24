// Drives headless Chromium through a render.html run and records peak renderer RSS.
//   node run-browser.mjs <url> <resultName> [timeoutSec]
import { chromium } from "playwright-core";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const [url, name, timeoutArg] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg || 900) * 1000;
const resultFile = `results/${name}.json`;
fs.rmSync(resultFile, { force: true });

const exe = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const tag = `--spike-tag=${name}-${process.pid}`;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox", tag] });
const page = await browser.newPage();
page.on("console", (m) => { const t = m.text(); if (/FAILED|error/i.test(t)) console.log("console:", t.slice(0, 300)); });

// Peak RSS of all renderer processes belonging to this browser (the ffmpeg worker lives in the page's renderer).
// The main browser process carries our tag and no --type= switch; its children are the renderers.
const browserPid = Number(execSync(`ps -axo pid=,args= | grep -F -- "${tag}" | grep -v -- "--type=" | grep -v grep | awk '{print $1}' | head -1`, { encoding: "utf8" }).trim());
console.log("browser pid", browserPid);
let peakRendererMB = 0, peakAllMB = 0;
const poll = setInterval(() => {
  try {
    const out = execSync(`ps -axo pid=,ppid=,rss=,args= | grep -F -- "--type=" | grep -v grep`, { encoding: "utf8" });
    let sumAll = 0, maxRenderer = 0;
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const [, , ppid, rss, cmd] = m;
      if (Number(ppid) !== browserPid) continue;
      const mb = Number(rss) / 1024;
      sumAll += mb;
      if (cmd.includes("--type=renderer")) maxRenderer = Math.max(maxRenderer, mb);
    }
    peakRendererMB = Math.max(peakRendererMB, maxRenderer);
    peakAllMB = Math.max(peakAllMB, sumAll);
  } catch {}
}, 500);

const t0 = Date.now();
await page.goto(url);
while (!fs.existsSync(resultFile) && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 1000));
clearInterval(poll);
const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, "utf8")) : { ok: false, error: "timeout" };
result.peakRendererRssMB = Math.round(peakRendererMB);
result.peakBrowserChildrenRssMB = Math.round(peakAllMB);
result.wallS = +((Date.now() - t0) / 1000).toFixed(1);
fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
