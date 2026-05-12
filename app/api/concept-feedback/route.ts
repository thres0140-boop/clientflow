import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const conceptId = req.nextUrl.searchParams.get("conceptId");

  const where: Record<string, unknown> = {};
  if (clientId) where.clientId = parseInt(clientId);
  if (conceptId) where.conceptId = parseInt(conceptId);

  const feedbacks = await prisma.conceptFeedback.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      concept: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(feedbacks);
}

const REASON_LABELS: Record<string, string> = {
  others_better: "Others were better",
  wrong_angle: "Wrong angle / topic",
  hook_bad: "Hook doesn't land",
  too_long: "Too long",
  too_short: "Too short",
  off_brand: "Off-brand",
  custom: "Custom feedback",
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const feedback = await prisma.conceptFeedback.create({
    data: {
      conceptId: parseInt(body.conceptId),
      clientId: parseInt(body.clientId),
      title: body.title,
      hook: body.hook || null,
      scriptSnippet: body.scriptSnippet || null,
      reasonType: body.reasonType,
      reason: body.reason || null,
    },
  });

  // Append rejection as a user turn in the concept's conversation history
  // so Claude sees it in context on the next generation
  try {
    const concept = await (prisma.concept as any).findUnique({
      where: { id: parseInt(body.conceptId) },
      select: { conversationHistory: true },
    });
    if (concept) {
      const history: { role: string; content: string }[] = JSON.parse(concept.conversationHistory || "[]");
      const label = REASON_LABELS[body.reasonType] || body.reasonType;
      const rejectionNote = [
        `FEEDBACK ON REJECTED SCRIPT — "${body.title}"`,
        body.hook ? `Hook: "${body.hook}"` : null,
        body.scriptSnippet ? `Script: "${body.scriptSnippet}"` : null,
        `Rejection reason: [${label}]${body.reason ? ` — "${body.reason}"` : ""}`,
        `Do NOT use this hook, angle, or structure again.`,
      ].filter(Boolean).join("\n");

      const updated = [...history, { role: "user", content: rejectionNote }].slice(-40);
      await (prisma.concept as any).update({
        where: { id: parseInt(body.conceptId) },
        data: { conversationHistory: JSON.stringify(updated) },
      });
    }
  } catch {
    // Non-fatal — don't block the rejection save
  }

  return NextResponse.json(feedback, { status: 201 });
}
