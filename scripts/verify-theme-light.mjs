#!/usr/bin/env node
// Proves a dark-mode conversion left LIGHT mode unchanged. See docs/dark-mode-conversion.md.
//
//   node scripts/verify-theme-light.mjs bg-white=bg-surface hover:bg-slate-50=hover:bg-surface-2 \
//        --color-nav-strip='#0f1c34' --shadow-nav-peek='8px 0 40px rgba(0,0,0,0.35)'
//
// old=new         a Tailwind utility you replaced and the token utility you replaced it with.
// --token=literal a token used from an inline style and the literal it replaced.
//
// It compiles app/globals.css with the project's Tailwind, flattens it, resolves every var()
// against the LIGHT :root blocks only, and fails unless each pair emits identical declarations.
// Alpha is compared at 8 bits (what the CSS minifier and the browser both do).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const twDir = path.dirname(require.resolve("tailwindcss/package.json"));
const { compile } = await import(path.join(twDir, "dist/lib.mjs"));
const { optimize } = await import(path.join(root, "node_modules/@tailwindcss/node/dist/index.mjs"));

const pairs = [], inline = [];
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf("=");
  if (i < 0) { console.error(`bad argument: ${arg}`); process.exit(2); }
  (arg.startsWith("--") ? inline : pairs).push([arg.slice(0, i), arg.slice(i + 1)]);
}
if (!pairs.length && !inline.length) { console.error("nothing to check"); process.exit(2); }

const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
let fail = 0;
if (!/@theme\s+static\s*\{/.test(css)) { console.log("FAIL  app/globals.css: the @theme block must be `@theme static` (see docs)"); fail++; }

const compiled = await compile(css, {
  base: root,
  loadStylesheet: async (id, base) => {
    const f = id === "tailwindcss" ? path.join(twDir, "index.css") : id.startsWith("tailwindcss/") ? path.join(twDir, id.slice(12)) : path.resolve(base, id);
    return { base: path.dirname(f), content: fs.readFileSync(f, "utf8") };
  },
  loadModule: async () => { throw new Error("modules not supported"); },
});
const built = optimize(compiled.build([...new Set(pairs.flat())]), { minify: false });
const out = typeof built === "string" ? built : built.code;

// light variables: rules whose selector is only :root / :host
const vars = {};
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
for (let m; (m = ruleRe.exec(out)); ) {
  const sel = m[1].trim().replace(/\s+/g, " ");
  if (!/^(:root|:host)(, ?(:root|:host))*$/.test(sel)) continue;
  for (const d of m[2].split(";")) { const i = d.indexOf(":"); if (i > 0 && d.trim().startsWith("--")) vars[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
}
const resolve = (v) => { let prev; do { prev = v; v = v.replace(/var\((--[\w-]+)(?:,([^)]*))?\)/g, (_, n, fb) => vars[n] ?? fb ?? `<UNSET ${n}>`); } while (v !== prev); return v; };
const to8 = (s) => s.replace(/\s+/g, "")
  .replace(/rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)/g, (_, r, g, b, a) => "#" + [r, g, b].map((x) => (+x).toString(16).padStart(2, "0")).join("") + (a === undefined ? "" : Math.round(+a * 255).toString(16).padStart(2, "0")))
  .replace(/#([0-9a-f]{3,4})\b/gi, (m, h) => h.length <= 4 ? "#" + [...h].map((c) => c + c).join("") : m)
  .replace(/^white$/i, "#ffffff").replace(/^black$/i, "#000000").toLowerCase();

const esc = (u) => "." + u.replace(/[:\/.%\[\]#]/g, (ch) => "\\" + ch);
function decls(u) {
  const e = esc(u), res = [];
  for (let m; (m = ruleRe.exec(out)); ) { const sel = m[1].trim(); const at = sel.indexOf(e); if (at >= 0 && !/[\w-]/.test(sel.charAt(at + e.length)) && (at === 0 || !/[\w-]/.test(sel.charAt(at - 1)))) res.push(...m[2].split(";").map((x) => x.trim()).filter(Boolean)); }
  ruleRe.lastIndex = 0;
  return res.map((d) => to8(resolve(d))).sort().join(" | ");
}
for (const [o, n] of pairs) {
  const a = decls(o), b = decls(n), ok = !!a && a === b;
  if (!ok) fail++;
  console.log(`${ok ? "OK  " : "FAIL"}  ${o} → ${n}` + (ok ? "" : `\n        old: ${a || "<no rule emitted>"}\n        new: ${b || "<no rule emitted>"}`));
}
for (const [k, lit] of inline) {
  const v = vars[k], ok = v !== undefined && to8(v) === to8(lit);
  if (!ok) fail++;
  console.log(`${ok ? "OK  " : "FAIL"}  ${k} = ${v ?? "<NOT EMITTED>"}` + (ok ? "" : `   expected ${lit}`));
}
console.log(fail ? `\n${fail} FAILURE(S): light mode would change` : "\nLIGHT MODE UNCHANGED");
process.exit(fail ? 1 : 0);
