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

  const styleInstructions = clientData?.captionStyle
    ? `Write captions in this specific style for ${clientData.name}:\n${clientData.captionStyle}`
    : `Write an engaging social media caption.`;

  const langInstruction = clientData?.language === "nl"
    ? "Write the caption in Dutch."
    : clientData?.language
    ? `Write the caption in ${clientData.language}.`
    : "";

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `Platform: ${platform || "instagram"}\nHook: ${hook || "N/A"}\nScript:\n${script || "N/A"}\n\nWrite the caption now.`,
      },
    ],
    system: `You are a social media caption writer. ${styleInstructions} ${langInstruction}\n\nOutput ONLY the caption text — no labels, no explanation.`,
  });

  const caption = message.content[0].type === "text" ? message.content[0].text.trim() : "";
  return NextResponse.json({ caption });
}
