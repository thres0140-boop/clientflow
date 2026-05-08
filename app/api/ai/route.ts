import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const REASON_LABELS: Record<string, string> = {
  others_better: "Others were better",
  wrong_angle: "Wrong angle / topic",
  hook_bad: "Hook doesn't land",
  too_long: "Too long",
  too_short: "Too short",
  off_brand: "Off-brand",
  custom: "Custom",
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { concept, language = "nl", clientName, clientId } = body;

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_key_here") {
    return NextResponse.json({ error: "Add your ANTHROPIC_API_KEY to .env.local" }, { status: 400 });
  }

  // Fetch the last 10 rejection feedbacks for this concept to build learning context
  let feedbackContext = "";
  if (clientId && concept.id) {
    try {
      const feedbacks = await prisma.conceptFeedback.findMany({
        where: { conceptId: concept.id, clientId: parseInt(clientId) },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      if (feedbacks.length > 0) {
        const lines = feedbacks.map((f: { reasonType: string; reason: string | null; hook: string | null }) => {
          const label = REASON_LABELS[f.reasonType] || f.reasonType;
          const detail = f.reason ? ` — "${f.reason}"` : "";
          const hook = f.hook ? ` | Hook: "${f.hook.slice(0, 60)}"` : "";
          return `• [${label}]${detail}${hook}`;
        });
        feedbackContext = `\n\nPREVIOUS REJECTION FEEDBACK FOR THIS CONCEPT (learn from these, do NOT repeat these mistakes):\n${lines.join("\n")}`;
      }
    } catch {
      // If feedback fetch fails, continue without it
    }
  }

  const langInstruction = language === "nl"
    ? "Write the script in Dutch."
    : `Write the script in ${language}.`;

  const prompt = `
Client: ${clientName || "Unknown"}
Concept Name: ${concept.name}
Hook Type: ${concept.hookType || "Not specified"}
Text Hook Template: ${concept.textHook || "Not specified"}
Audio Hook: ${concept.audioHook || "Not specified"}
Video Type: ${concept.videoType || "Not specified"}
Angle: ${concept.angle || "Not specified"}
Structure: ${concept.structure || "Not specified"}
Guidelines: ${concept.guidelines || "Not specified"}${feedbackContext}

Generate a complete, engaging video script following these guidelines exactly. Format it clearly with the hook, main content sections, and CTA. Keep it tight and punchy. 80–130 words max. ${langInstruction}
  `.trim();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
    system: "You are an expert social media script writer who creates viral short-form video scripts. Follow the exact guidelines provided. Learn from any rejection feedback given — avoid the same mistakes. Output only the script itself — no preamble, no explanation.",
  });

  const script = message.content[0].type === "text" ? message.content[0].text : "";
  return NextResponse.json({ script });
}
