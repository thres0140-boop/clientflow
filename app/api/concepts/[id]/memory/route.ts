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
  custom: "Custom feedback",
};

// POST — synthesize all data into a living memory document
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { clientId } = await req.json();

  const concept = await prisma.concept.findUnique({ where: { id: parseInt(id) } });
  if (!concept) return NextResponse.json({ error: "Concept not found" }, { status: 404 });

  const clientData = await prisma.client.findUnique({ where: { id: parseInt(clientId) } });
  if (!clientData) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const feedbacks = await prisma.conceptFeedback.findMany({
    where: { conceptId: concept.id, clientId: parseInt(clientId) },
    orderBy: { createdAt: "asc" },
  });

  // Build full context for Claude to synthesize
  const blueprintLines = [
    concept.hookType   && `Hook Type: ${concept.hookType}`,
    concept.textHook   && `Text Hook: "${concept.textHook}"`,
    concept.videoType  && `Video Type: ${concept.videoType}`,
    concept.angle      && `Angle: ${concept.angle}`,
    concept.structure  && `Structure: ${concept.structure}`,
    concept.guidelines && `Guidelines: ${concept.guidelines}`,
  ].filter(Boolean).join("\n");

  const examplesSection = concept.scriptExamples
    ? concept.scriptExamples.split(/\n{2,}/).filter(Boolean)
        .map((ex, i) => `Example ${i + 1}:\n${ex.trim()}`).join("\n\n")
    : "No example scripts provided yet.";

  const rejectionLines = feedbacks.map((f, i) => {
    const label = REASON_LABELS[f.reasonType] || f.reasonType;
    const reason = f.reason ? `\n   Feedback: "${f.reason}"` : "";
    const hook = f.hook ? `\n   Hook: "${f.hook}"` : "";
    const snippet = f.scriptSnippet ? `\n   Script: "${f.scriptSnippet}"` : "";
    return `${i + 1}. [${label}]${reason}${hook}${snippet}`;
  }).join("\n\n");

  const existingMemory = concept.aiMemory
    ? `\n\n--- PREVIOUS MEMORY (update and expand this, don't start from scratch) ---\n${concept.aiMemory}`
    : "";

  const prompt = `You are building a living memory document about a creator's content concept. Your job is to synthesize everything known about this concept into a sharp, useful memory that will help generate better scripts over time.

=== CREATOR: ${clientData.name} ===
=== CONCEPT: ${concept.name} ===

--- BLUEPRINT ---
${blueprintLines || "No blueprint set."}

--- EXAMPLE SCRIPTS (the voice and style to match) ---
${examplesSection}

--- REJECTION HISTORY (${feedbacks.length} total) ---
${feedbacks.length > 0 ? rejectionLines : "No rejections yet."}
${existingMemory}

=== YOUR TASK ===
Write a living memory document that captures everything you've learned about this creator and this concept. This document will be read before every script generation to make Claude smarter.

Structure it clearly under these headings:
**VOICE & STYLE** — how this creator actually talks, their patterns, their energy
**WHAT WORKS** — angles, structures, hooks, tones that land (from examples + what wasn't rejected)
**WHAT DOESN'T WORK** — specific patterns to avoid, synthesized from rejections (not just a list — explain WHY they fail for this creator)
**HOOK INTELLIGENCE** — what makes a hook stop the scroll for THIS creator's audience specifically
**AUDIENCE INSIGHTS** — what you've inferred about who's watching and what triggers them
**GENERATION NOTES** — specific instructions for the next writer, things to always/never do

Be specific. Be direct. Write this like a briefing document for a writer who's never met this creator but needs to nail the voice immediately. The more precise, the better.${feedbacks.length === 0 ? "\n\nNote: No rejections yet — base the memory on the example scripts and blueprint only. Keep it shorter since there's less data." : ""}`.trim();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: "You are a creative director who deeply studies creator voice and content performance patterns. Write the memory document in clear, direct prose — no fluff. Be specific and actionable.",
    messages: [{ role: "user", content: prompt }],
  });

  const memory = message.content[0].type === "text" ? message.content[0].text : "";

  const updated = await prisma.concept.update({
    where: { id: concept.id },
    data: { aiMemory: memory, memoryUpdatedAt: new Date() },
  });

  return NextResponse.json({ aiMemory: updated.aiMemory, memoryUpdatedAt: updated.memoryUpdatedAt });
}

// PATCH — manually edit memory
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { aiMemory } = await req.json();

  const updated = await prisma.concept.update({
    where: { id: parseInt(id) },
    data: { aiMemory: aiMemory || null, memoryUpdatedAt: new Date() },
  });

  return NextResponse.json({ aiMemory: updated.aiMemory, memoryUpdatedAt: updated.memoryUpdatedAt });
}
