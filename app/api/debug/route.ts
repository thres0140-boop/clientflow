import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const connections = await prisma.instagramConnection.findMany();
  const leads = await prisma.dmLead.findMany({ take: 10, orderBy: { id: "desc" } });

  // ?insert=1 creates a test lead for the first connected client
  if (req.nextUrl.searchParams.get("insert") === "1") {
    const conn = connections.find(c => c.unipileAccountId);
    if (conn) {
      const lead = await prisma.dmLead.create({
        data: { clientId: conn.clientId, name: "TEST LEAD", handle: "test_handle", status: "messaged", date: new Date().toISOString().slice(0, 10) }
      });
      return NextResponse.json({ inserted: lead, connections, recentLeads: leads });
    }
  }

  return NextResponse.json({ connections, recentLeads: leads });
}
