import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
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
