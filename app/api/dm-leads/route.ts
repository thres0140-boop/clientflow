import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const where = clientId ? { clientId: parseInt(clientId) } : {};
  const leads = await prisma.dmLead.findMany({ where, orderBy: { createdAt: "desc" } });
  return NextResponse.json(leads);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const lead = await prisma.dmLead.create({
    data: {
      clientId: parseInt(body.clientId),
      name: body.name,
      handle: body.handle || null,
      status: body.status || "messaged",
      notes: body.notes || null,
    },
  });
  return NextResponse.json(lead);
}
