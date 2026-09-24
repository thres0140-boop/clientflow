#!/usr/bin/env node
// Build-time guard: the agency app and the AI-business app must never share a database
// client, a session module, or product code. Runs FIRST in `npm run build`, so a violation
// fails the Vercel build. A convention in a doc is not enough; a copy-paste slip is.
//
// Rules
//   1. AI tree (ai/**, app/ai/**) may not import the agency's database, session/cookie/
//      permission modules, product server modules, features, or API routes.
//   2. Agency tree (everything else under app/, features/, shared/, proxy.ts, next.config.ts)
//      may not import anything from ai/** or app/ai/** or the AI generated client —
//      except ai/slug (URL constants only), allowed from proxy.ts and next.config.ts.
//   3. app/generated/prisma-ai/client is importable ONLY by ai/db/prisma.ts.
//      app/generated/prisma/client   is importable ONLY by shared/db/prisma.ts.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN = ["app", "ai", "features", "shared", "proxy.ts", "next.config.ts"];
const EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);

function walk(p, out = []) {
  if (!fs.existsSync(p)) return out;
  const st = fs.statSync(p);
  if (st.isFile()) { if (EXT.has(path.extname(p))) out.push(p); return out; }
  if (path.basename(p) === "generated" && path.dirname(p).endsWith("app")) return out; // generated clients
  for (const e of fs.readdirSync(p)) walk(path.join(p, e), out);
  return out;
}

const files = SCAN.flatMap((s) => walk(path.join(ROOT, s)));
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const isAiFile = (r) => r.startsWith("ai/") || r.startsWith("app/ai/");

// Resolve a specifier to a repo-relative path ("@/x" and relative imports); bare packages → null.
function resolve(fromRel, spec) {
  if (spec.startsWith("@/")) return spec.slice(2);
  if (spec.startsWith(".")) return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  return null;
}

const SPEC_RE = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']([^"']+)["']/g;

const AGENCY_ONLY = [
  /^shared\/db\/prisma$/, /^shared\/auth\/(session|cookie|permissions)$/, /^shared\/activity$/,
  /^shared\/notify\/push$/, /^shared\/media\/(r2|mediaCleanup)$/, /^shared\/types$/,
  /^shared\/ui\/(Sidebar|PushToggle)$/, /^features\//, /^app\/api\//, /^app\/page$/, /^app\/generated\/prisma\//,
];
const AI_ONLY = [/^ai\//, /^app\/ai\//, /^app\/generated\/prisma-ai\//];
const SLUG_ALLOWED_FROM = new Set(["proxy.ts", "next.config.ts"]);

const errors = [];
for (const f of files) {
  const r = rel(f);
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(SPEC_RE)) {
    const target = resolve(r, m[1]);
    if (!target) continue;
    const t = target.replace(/\.(ts|tsx|js|mjs)$/, "");
    if (isAiFile(r)) {
      if (AGENCY_ONLY.some((re) => re.test(t))) errors.push(`${r} imports agency module "${m[1]}"`);
      if (/^app\/generated\/prisma-ai\//.test(t) && r !== "ai/db/prisma.ts") errors.push(`${r} imports the AI generated client directly (only ai/db/prisma.ts may)`);
    } else {
      const slugOnly = t === "ai/slug" && SLUG_ALLOWED_FROM.has(r);
      if (!slugOnly && AI_ONLY.some((re) => re.test(t))) errors.push(`${r} imports AI product module "${m[1]}"`);
      if (/^app\/generated\/prisma\//.test(t) && r !== "shared/db/prisma.ts") errors.push(`${r} imports the agency generated client directly (only shared/db/prisma.ts may)`);
    }
  }
}

if (errors.length) {
  console.error(`✖ DB/product boundary violations (${errors.length}):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ DB/product boundaries OK (${files.length} files checked)`);
