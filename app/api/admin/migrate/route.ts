import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// One-time migration endpoint — adds columns that are new in the schema.
// Call once after deploy, then this is a no-op (IF NOT EXISTS is safe to re-run).
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("token") || req.headers.get("x-admin-secret");
  if (secret !== "zernio-migrate-2024") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await (prisma as any).$executeRaw`
      ALTER TABLE "InstagramConnection"
      ADD COLUMN IF NOT EXISTS "zernioAccountId" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "ContentPiece"
      ADD COLUMN IF NOT EXISTS "igMediaId" TEXT;
    `;
    await (prisma as any).$executeRaw`
      ALTER TABLE "InstagramConnection"
      ADD COLUMN IF NOT EXISTS "zernioProfileId" TEXT;
    `;
    return NextResponse.json({ ok: true, message: "Migration complete." });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
