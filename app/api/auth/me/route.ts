import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";
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

  return NextResponse.json({
    ...session,
    ownerName: process.env.OWNER_NAME ?? "Owner",
    ownerEmail: process.env.OWNER_EMAIL ?? null,
    projects,
  });
}
