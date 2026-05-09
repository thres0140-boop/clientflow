import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const connections = await prisma.instagramConnection.findMany();
  const leads = await prisma.dmLead.findMany({ take: 10, orderBy: { id: "desc" } });
  return NextResponse.json({ connections, recentLeads: leads });
}
