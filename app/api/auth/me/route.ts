import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, createSessionToken } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!token) return NextResponse.json(null);
  const session = await verifySessionToken(token);
  if (!session) return NextResponse.json(null);

  // Multi-project: a member's email can be on several projects (one record each).
  // Surface them all so the UI can show a project switcher.
  let projects: any[] = [];
  if (session.type === "member" && session.memberId) {
    const me = await prisma.teamMember.findUnique({ where: { id: session.memberId }, select: { email: true } });
    if (me?.email) {
      const siblings = await prisma.teamMember.findMany({
        where: { email: { equals: me.email, mode: "insensitive" }, clientId: { not: null } },
        select: { id: true, name: true, color: true, clientId: true, pageAccess: true, viewOnlyPages: true, isClientAccount: true,
          client: { select: { name: true, color: true } } } as any,
        orderBy: { id: "asc" },
      });
      projects = siblings.map((s: any) => ({
        memberId: s.id, name: s.name, color: s.color, clientId: s.clientId,
        clientName: s.client?.name ?? null, clientColor: s.client?.color ?? null,
        pageAccess: s.pageAccess, viewOnlyPages: s.viewOnlyPages, isClientAccount: s.isClientAccount,
      }));
    }
  }

  const res = NextResponse.json({
    ...session,
    ownerName: process.env.OWNER_NAME ?? "Owner",
    ownerEmail: process.env.OWNER_EMAIL ?? null,
    projects,
  });

  // Keep the session token's project-access list current (members added to new
  // projects after login would otherwise be blocked by middleware → page crashes).
  if (session.type === "member" && projects.length) {
    const freshIds = projects.map((p) => p.clientId).filter((x) => x != null);
    const cur = Array.isArray((session as any).clientIds) ? (session as any).clientIds : [];
    const changed = freshIds.length !== cur.length || freshIds.some((id: number) => !cur.includes(id));
    if (changed) {
      const fresh = await createSessionToken({
        type: "member", memberId: session.memberId, name: session.name,
        clientId: session.clientId ?? null, clientIds: freshIds,
      });
      res.cookies.set("cf_session", fresh, {
        httpOnly: true, secure: process.env.NODE_ENV === "production",
        sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/",
      });
    }
  }
  return res;
}
