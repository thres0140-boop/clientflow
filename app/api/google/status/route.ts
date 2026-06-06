import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

// GET /api/google/status — is Google Drive connected? (owner only)
export async function GET(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (session?.type !== "owner") return NextResponse.json({ connected: false });
  const auth = await (prisma as any).googleAuth.findUnique({ where: { scope: "workspace" } }).catch(() => null);
  return NextResponse.json({
    connected: !!auth,
    email: auth?.email ?? null,
    configured: !!process.env.GOOGLE_CLIENT_ID,
  });
}

// DELETE /api/google/status — disconnect.
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (session?.type !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await (prisma as any).googleAuth.deleteMany({ where: { scope: "workspace" } });
  return NextResponse.json({ ok: true });
}
