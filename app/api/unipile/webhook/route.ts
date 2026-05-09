import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const event = body.event ?? body.type ?? "";
    const accountId = body.account_id ?? body.data?.account_id;

    console.log(`[webhook] event=${event} account=${accountId} body=${JSON.stringify(body).slice(0, 300)}`);

    if (!accountId) return NextResponse.json({ ok: true });

    const conn = await prisma.instagramConnection.findFirst({
      where: { unipileAccountId: accountId },
    });
    if (!conn) return NextResponse.json({ ok: true });

    const clientId = conn.clientId;

    // ── Incoming DM ────────────────────────────────────────────────────────
    if (event === "message.created" || event === "message.received" || event === "messaging") {
      const msg = body.data ?? body;
      const isOwn = msg.is_sender ?? false;
      if (isOwn) return NextResponse.json({ ok: true });

      const senderName: string = msg.sender_name ?? msg.from_name ?? "Instagram User";
      const handle: string | null = msg.sender_username ?? msg.from_username ?? null;

      // Auto-create lead at "messaged" if not already in pipeline
      await upsertLead(clientId, senderName, handle, "messaged");
    }

    // ── New follower ───────────────────────────────────────────────────────
    const isFollowerEvent =
      event === "follower.new" ||
      event === "new_follower" ||
      event === "contacts.new" ||
      event === "attendee.created" ||
      event === "relation.new" ||
      event === "contact.new" ||
      event?.toLowerCase().includes("follow") ||
      event?.toLowerCase().includes("relation");

    if (isFollowerEvent) {
      const data = body.data ?? body;
      const name: string =
        data.display_name ?? data.name ?? data.username ?? data.handle ?? "Instagram User";
      const handle: string | null =
        data.username ?? data.handle ?? data.screen_name ?? null;

      console.log(`[webhook] new follower for client ${clientId}: ${handle ?? name}`);
      await upsertLead(clientId, name, handle, "follows");
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Unipile webhook error:", err);
    return NextResponse.json({ ok: true }); // always 200 to Unipile
  }
}

// Creates lead if no lead with same handle/clientId exists.
// If lead exists at "follows" and newStatus is "messaged", promotes it.
async function upsertLead(
  clientId: number,
  name: string,
  handle: string | null,
  newStatus: string
) {
  const today = new Date().toISOString().slice(0, 10);

  if (handle) {
    const existing = await prisma.dmLead.findFirst({
      where: { clientId, handle },
    });
    if (existing) {
      // Promote follows → messaged, but don't downgrade other statuses
      const promotable = ["follows"];
      if (promotable.includes(existing.status) && newStatus === "messaged") {
        await prisma.dmLead.update({
          where: { id: existing.id },
          data: { status: "messaged", date: existing.date ?? today },
        });
      }
      return;
    }
  }

  await prisma.dmLead.create({
    data: { clientId, name, handle, status: newStatus, date: today },
  });
}
