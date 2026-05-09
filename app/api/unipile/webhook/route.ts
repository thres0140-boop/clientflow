import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Unipile webhook events: message.created, etc.
    const event = body.event ?? body.type;
    const accountId = body.account_id ?? body.data?.account_id;

    if (!accountId) return NextResponse.json({ ok: true });

    // Find which client owns this Unipile account
    const conn = await prisma.instagramConnection.findFirst({
      where: { unipileAccountId: accountId },
    });
    if (!conn) return NextResponse.json({ ok: true });

    if (event === "message.created" || event === "messaging") {
      const msg = body.data ?? body;
      const senderId = msg.sender_id ?? msg.from_id;
      const text = msg.text ?? msg.body ?? "";
      const isOwn = msg.is_sender ?? false;

      if (!text || isOwn) return NextResponse.json({ ok: true });

      // Log incoming DM (extend as needed)
      console.log(`[Unipile] DM for client ${conn.clientId} from ${senderId}: ${text.slice(0, 80)}`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Unipile webhook error:", err);
    return NextResponse.json({ ok: true }); // always 200 to Unipile
  }
}
