import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST { clientId, name, handle, status }
// Creates the lead or promotes it (follows → messaged)
export async function POST(req: NextRequest) {
  const { clientId, name, handle, status } = await req.json();
  const today = new Date().toISOString().slice(0, 10);

  if (handle) {
    const existing = await prisma.dmLead.findFirst({
      where: { clientId: parseInt(clientId), handle },
    });
    if (existing) {
      const promotable = ["follows"];
      if (promotable.includes(existing.status) && status === "messaged") {
        const updated = await prisma.dmLead.update({
          where: { id: existing.id },
          data: { status: "messaged", date: existing.date ?? today },
        });
        return NextResponse.json(updated);
      }
      return NextResponse.json(existing);
    }
  }

  const lead = await prisma.dmLead.create({
    data: {
      clientId: parseInt(clientId),
      name,
      handle: handle || null,
      status,
      date: today,
    },
  });
  return NextResponse.json(lead);
}
