import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_key_here") {
    return NextResponse.json({ error: "Add your ANTHROPIC_API_KEY to .env.local" }, { status: 400 });
  }

  const body = await req.json();
  const { clientId, hook, script, platform } = body;

  const clientData = clientId
    ? await prisma.client.findUnique({ where: { id: parseInt(clientId) } })
    : null;

  // Prefer the learned caption playbook (derived from the creator's real reel
  // captions); fall back to the manual caption-style field, then a generic prompt.
  const guidelines = (clientData as any)?.captionGuidelines as string | null | undefined;
  const styleInstructions = guidelines
    ? `Write the caption following ${clientData?.name}'s CAPTION PLAYBOOK (learned from their real reel captions). Match it closely — opening style, CTA, emoji, length, voice:\n\n${guidelines}`
    : clientData?.captionStyle
    ? `Write captions in this specific style for ${clientData.name}:\n${clientData.captionStyle}`
    : `Write an engaging social media caption.`;

  const langInstruction = clientData?.language === "nl"
    ? "Write the caption in Dutch."
    : clientData?.language
    ? `Write the caption in ${clientData.language}.`
    : "";

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024, // a full playbook caption (200-350 words) + CTA needs room — 300 truncated it
    messages: [
      {
        role: "user",
        content: `Platform: ${platform || "instagram"}\nHook: ${hook || "N/A"}\nScript:\n${script || "N/A"}\n\nWrite the caption now. Write the COMPLETE caption and ALWAYS finish with the playbook's CTA (the 📩 DM line) — never stop before the CTA.`,
      },
    ],
    system: `You are a social media caption writer. ${styleInstructions} ${langInstruction}\n\nCRITICAL: output the FULL caption and it MUST end with the CTA structure from the playbook (the 📩 DM "keyword" line). Never omit or truncate the CTA. Output ONLY the caption text — no labels, no explanation.`,
  });

  const caption = message.content[0].type === "text" ? message.content[0].text.trim() : "";
  return NextResponse.json({ caption });
}
