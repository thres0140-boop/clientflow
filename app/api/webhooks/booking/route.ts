import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Booking webhook — called by Calendly or Cal.com when someone books.
 *
 * Usage:
 *   Webhook URL: https://ordoagency.com/api/webhooks/booking?clientId=<ID>
 *   Trigger events: invitee.created (Calendly) | BOOKING_CREATED (Cal.com)
 *
 * Behaviour:
 *   1. Extract the invitee name & email from the payload.
 *   2. Find the best-matching DmLead for that client (by name similarity).
 *   3. If the lead is at "link_sent" (or earlier), promote it to "booked".
 *   4. If no lead matches, create a new "booked" lead so nothing is lost.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const clientId = Number(searchParams.get("clientId"));

  if (!clientId || isNaN(clientId)) {
    return NextResponse.json({ error: "Missing or invalid clientId" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Parse invitee info from Calendly or Cal.com payload ──────────────────

  let inviteeName: string | null = null;
  let inviteeEmail: string | null = null;

  // Calendly: { event: "invitee.created", payload: { name, email, ... } }
  if (body?.event === "invitee.created" && body?.payload) {
    inviteeName  = body.payload.name  ?? null;
    inviteeEmail = body.payload.email ?? null;
  }
  // Cal.com: { triggerEvent: "BOOKING_CREATED", payload: { attendees: [{name, email}], ... } }
  else if (body?.triggerEvent === "BOOKING_CREATED" && body?.payload) {
    const attendee = body.payload?.attendees?.[0] ?? body.payload?.responses;
    inviteeName  = attendee?.name  ?? body.payload?.title ?? null;
    inviteeEmail = attendee?.email ?? null;
  }
  // GoHighLevel: { type: "AppointmentCreate", contact: { name, email } }
  // or: { type: "AppointmentCreate", first_name, last_name, email }
  else if (body?.type?.toLowerCase().includes("appointment") || body?.type?.toLowerCase().includes("contact")) {
    const contact = body.contact ?? body;
    const fullName = contact.name ?? contact.full_name ??
      [contact.first_name, contact.last_name].filter(Boolean).join(" ") ?? null;
    inviteeName  = fullName || null;
    inviteeEmail = contact.email ?? null;
  }
  // Generic fallback: look for name/email anywhere at the top level
  else {
    inviteeName  = body?.name ?? body?.full_name ?? body?.inviteeName ??
      ([body?.first_name, body?.last_name].filter(Boolean).join(" ") || null);
    inviteeEmail = body?.email ?? body?.inviteeEmail ?? null;
  }

  if (!inviteeName) {
    console.warn("[booking-webhook] Could not parse invitee name from payload:", JSON.stringify(body).slice(0, 300));
    return NextResponse.json({ error: "Could not parse invitee name" }, { status: 422 });
  }

  console.log(`[booking-webhook] clientId=${clientId} invitee="${inviteeName}" email="${inviteeEmail}"`);

  // ── Find the best matching lead ───────────────────────────────────────────

  const statusOrder = ["messaged", "link_sent", "booked", "no_show", "unqualified", "no_close", "closed"];
  const bookedIdx   = statusOrder.indexOf("booked");

  const leads = await prisma.dmLead.findMany({ where: { clientId } });

  // Score each lead: exact full-name match = 3, first-name match = 2, substring = 1
  const normalName = inviteeName.toLowerCase().trim();
  const firstName  = normalName.split(/\s+/)[0];

  let bestLead: (typeof leads)[0] | null = null;
  let bestScore = 0;

  for (const lead of leads) {
    const leadName = lead.name.toLowerCase().trim();
    let score = 0;
    if (leadName === normalName)              score = 3;
    else if (leadName.startsWith(firstName))  score = 2;
    else if (leadName.includes(firstName) || normalName.includes(leadName.split(/\s+/)[0])) score = 1;

    if (score > bestScore) {
      bestScore = score;
      bestLead  = lead;
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  if (bestLead && bestScore > 0) {
    const currentIdx = statusOrder.indexOf(bestLead.status);

    if (currentIdx >= bookedIdx) {
      // Already booked or further — don't downgrade
      console.log(`[booking-webhook] Lead ${bestLead.id} already at "${bestLead.status}", skipping`);
      return NextResponse.json({ ok: true, action: "skipped", reason: "already_advanced", leadId: bestLead.id });
    }

    await prisma.dmLead.update({
      where: { id: bestLead.id },
      data:  { status: "booked" },
    });

    console.log(`[booking-webhook] Promoted lead ${bestLead.id} (@${bestLead.handle}) from "${bestLead.status}" → "booked" (score=${bestScore})`);
    return NextResponse.json({ ok: true, action: "promoted", leadId: bestLead.id, from: bestLead.status });
  }

  // No matching lead found — create a fresh "booked" lead so nothing is lost
  const newLead = await prisma.dmLead.create({
    data: {
      clientId,
      name:   inviteeName,
      handle: inviteeEmail ?? null,   // store email as handle placeholder if no IG handle
      status: "booked",
      date:   today,
      notes:  inviteeEmail ? `Email: ${inviteeEmail}` : null,
    },
  });

  console.log(`[booking-webhook] No match found — created new "booked" lead ${newLead.id} for "${inviteeName}"`);
  return NextResponse.json({ ok: true, action: "created", leadId: newLead.id });
}
