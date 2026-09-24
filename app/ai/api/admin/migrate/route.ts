import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/ai/db/prisma";
import { isAdminToken } from "@/shared/auth/adminToken";
import { AI_MIGRATIONS } from "@/ai/db/migrations.generated";

export const runtime = "nodejs";
export const maxDuration = 120;

// AI database schema runner.
//   GET  ?token=  → which SQL files are applied / pending (read-only)
//   POST ?token=  → apply every pending file, each in its own transaction, recording it in
//                   "_ai_migrations". Files come from prisma-ai/init.sql (0000_init) and
//                   prisma-ai/migrations/*.sql, bundled at build time (scripts/build-ai-migrations.mjs).
// Bound to the AI Prisma client only — this route cannot reach the agency database.

async function ensureLedger() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_ai_migrations" ("name" TEXT PRIMARY KEY, "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now())`);
}

async function applied(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT "name" FROM "_ai_migrations"`);
  return new Set(rows.map((r) => r.name));
}

// Split a DDL script into statements. The files are Prisma-generated (no functions, no
// dollar-quoting), so a semicolon at end of line is a reliable delimiter.
function statements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--[^\n]*\n?/gm, "").trim())
    .filter((s) => s.length > 0);
}

export async function GET(req: NextRequest) {
  if (!isAdminToken(req.nextUrl.searchParams.get("token"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureLedger();
  const done = await applied();
  return NextResponse.json({
    applied: AI_MIGRATIONS.filter((m) => done.has(m.name)).map((m) => m.name),
    pending: AI_MIGRATIONS.filter((m) => !done.has(m.name)).map((m) => m.name),
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminToken(req.nextUrl.searchParams.get("token"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureLedger();
  const done = await applied();
  const out: { applied: string[]; skipped: string[]; error?: string } = { applied: [], skipped: [] };
  for (const m of AI_MIGRATIONS) {
    if (done.has(m.name)) { out.skipped.push(m.name); continue; }
    try {
      await prisma.$transaction(async (tx) => {
        for (const s of statements(m.sql)) await tx.$executeRawUnsafe(s);
        await tx.$executeRawUnsafe(`INSERT INTO "_ai_migrations" ("name") VALUES ($1)`, m.name);
      }, { timeout: 100_000 });
      out.applied.push(m.name);
    } catch (e) {
      out.error = `${m.name}: ${e instanceof Error ? e.message : String(e)}`;
      return NextResponse.json(out, { status: 500 }); // stop at the first failure; nothing partial is recorded
    }
  }
  return NextResponse.json(out);
}
