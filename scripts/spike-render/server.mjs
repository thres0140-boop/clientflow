// Static server for the render spike.
//   node server.mjs --port 4100 --root www [--coi] [--cors] [--corp]
//   --coi   : send COOP same-origin + COEP require-corp (cross-origin isolation)
//   --cors  : send Access-Control-Allow-Origin: * on every file (simulates an R2 bucket with CORS)
//   --corp  : send Cross-Origin-Resource-Policy: cross-origin (what a CDN would need under COEP)
// POST /result?name=x stores the JSON body under results/x.json.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const port = Number(opt("--port", 4100));
const root = path.resolve(opt("--root", "www"));
const resultsDir = path.resolve("results");
fs.mkdirSync(resultsDir, { recursive: true });

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".mp4": "video/mp4", ".ass": "text/plain", ".ttf": "font/ttf", ".png": "image/png", ".json": "application/json", ".css": "text/css" };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://x`);
  if (flag("--coi")) {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  }
  if (flag("--cors")) res.setHeader("Access-Control-Allow-Origin", "*");
  if (flag("--corp")) res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (req.method === "POST" && url.pathname === "/result") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const name = (url.searchParams.get("name") || "result").replace(/[^\w.-]/g, "_");
      fs.writeFileSync(path.join(resultsDir, name + ".json"), body);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end("ok");
    });
    return;
  }
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); res.end(); return; }
  const file = path.join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end("nf"); return; }
  const stat = fs.statSync(file);
  res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace("bytes=", "").split("-");
    const start = Number(s), end = e ? Number(e) : stat.size - 1;
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`spike server :${port} root=${root} coi=${flag("--coi")} cors=${flag("--cors")} corp=${flag("--corp")}`));
