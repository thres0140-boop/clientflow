import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export async function GET(req: NextRequest) {
  const include = {
    instagramConnection: {
      select: { zernioAccountId: true, accessToken: true, igUsername: true, zernioProfileId: true, profilePictureUrl: true },
    },
  };

  // Scope by session: owners see all clients; members (team/client) see ONLY the
  // client they're assigned to. Never leak other clients (or their access tokens).
  const token = req.cookies.get("cf_session")?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (session?.type === "member") {
    if (!session.memberId) return NextResponse.json([]);
    const member = await prisma.teamMember.findUnique({ where: { id: session.memberId }, select: { clientId: true, email: true } });
    if (!member?.clientId) return NextResponse.json([]);
    // Return every project this person is on (all records sharing their email), so a
    // multi-project client/member can switch between them. Falls back to their one project.
    let clientIds = [member.clientId];
    if (member.email) {
      const siblings = await prisma.teamMember.findMany({
        where: { email: { equals: member.email, mode: "insensitive" }, clientId: { not: null } },
        select: { clientId: true },
      });
      clientIds = Array.from(new Set(siblings.map((s) => s.clientId!).concat(member.clientId)));
    }
    const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, orderBy: { name: "asc" }, include });
    return NextResponse.json(clients);
  }

  const clients = await prisma.client.findMany({ orderBy: { name: "asc" }, include });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const client = await prisma.client.create({
    data: {
      name: body.name,
      platform: body.platform || "instagram",
      profileUrl: body.profileUrl || null,
      color: body.color || "#6366f1",
      notes: body.notes || null,
      captionStyle: body.captionStyle || null,
      isTestAccount: body.isTestAccount === true,
    },
  });
  return NextResponse.json(client, { status: 201 });
}
