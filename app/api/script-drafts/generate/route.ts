import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_RULES = `1. VOICE IS EVERYTHING
   The #1 mistake is writing scripts that sound "written."
   Every line must sound like the creator talking to a friend.
   If it sounds like a copywriter wrote it → rewrite.

2. DATA OVER OPINION
   Every decision (hook formula, structure, duration, visuals, audio)
   must be backed by the actual performance data from the videos.
   "This hook style averaged 250K views" beats "I think this works."

3. SPECIFICITY WINS
   Vague hooks underperform. Specific trigger words, specific moments,
   specific details — these stop the scroll.

4. CONTRAST = SCROLL STOPPER
   In most niches, the combination of calm delivery/music with hard
   or controversial words creates the pattern interrupt that stops
   people from scrolling. Check if this applies to your creator.

5. THE SYSTEM IS ALIVE
   After the first batch of scripts goes live, track what performs.
   Feed the data back: kill what doesn't work, double down on what does.
   Update the style guide, add new trigger words, remove dead concepts.

6. CAPTION ≠ SCRIPT
   This is the most common mistake. The caption must approach the
   SAME THEME from a COMPLETELY DIFFERENT ANGLE. If the script talks
   about the moment of weakness, the caption talks about the people
   watching you fall. Same theme, different perspective.

7. 2+ PILLARS OR KILL IT
   Single-pillar content is generic. If a script only touches one
   pillar, it's not specific enough to the creator. Merge pillars
   for stronger, more unique content`;

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
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_key_here") {
    return NextResponse.json({ error: "Add your ANTHROPIC_API_KEY to .env.local" }, { status: 400 });
  }

  const body = await req.json();
  const { clientId, conceptIds, weekLabel, dayLabel, count = 5 } = body;

  const clientData = await prisma.client.findUnique({ where: { id: parseInt(clientId) } });
  if (!clientData) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const concepts = await prisma.concept.findMany({
    where: { id: { in: conceptIds.map(Number) } },
  });

  const langInstruction = clientData.language === "nl"
    ? "Write in Dutch."
    : `Write in ${clientData.language}.`;

  const created = [];

  for (const concept of concepts) {
    // Load ALL rejection history — no limit
    const feedbacks = await prisma.conceptFeedback.findMany({
      where: { conceptId: concept.id, clientId: clientData.id },
      orderBy: { createdAt: "desc" },
    });

    // --- Build prompt sections ---

    // 1. Blueprint
    const blueprintLines = [
      concept.hookType    && `Hook Type: ${concept.hookType}`,
      concept.textHook    && `Text Hook: "${concept.textHook}"`,
      concept.videoType   && `Video Type: ${concept.videoType}`,
      concept.angle       && `Angle: ${concept.angle}`,
      concept.structure   && `Structure: ${concept.structure}`,
      concept.guidelines  && `Guidelines:\n${concept.guidelines}`,
    ].filter(Boolean).join("\n");

    // 2. Example scripts
    let examplesSection = "";
    if (concept.scriptExamples) {
      const examples = concept.scriptExamples.split(/\n{2,}/).filter(Boolean);
      examplesSection = `\n\n--- EXAMPLE SCRIPTS (study these — this is the voice and style to match) ---\n` +
        examples.map((ex, i) => `Example ${i + 1}:\n${ex.trim()}`).join("\n\n");
    }

    // 3. Writing rules
    const writingRules = concept.scriptRules ?? DEFAULT_RULES;
    const rulesSection = `\n\n--- WRITING RULES (follow these strictly) ---\n${writingRules}`;

    // 4. Caption style
    const captionSection = clientData.captionStyle
      ? `\n\n--- CAPTION STYLE ---\n${clientData.captionStyle}`
      : "";

    // 5. Rejection history — full scripts + reasons
    let rejectionSection = "";
    if (feedbacks.length > 0) {
      const lines = feedbacks.map((f, i) => {
        const label = REASON_LABELS[f.reasonType] || f.reasonType;
        const reason = f.reason ? `\n   Reason: "${f.reason}"` : "";
        const hook = f.hook ? `\n   Rejected hook: "${f.hook}"` : "";
        const snippet = f.scriptSnippet ? `\n   Rejected script: "${f.scriptSnippet}"` : "";
        return `${i + 1}. [${label}]${reason}${hook}${snippet}`;
      });
      rejectionSection = `\n\n--- REJECTION TRAINING (${feedbacks.length} rejections — do NOT repeat any of these patterns) ---\n${lines.join("\n\n")}`;
    }

    const prompt = `You are writing ${count} alternative scripts for a social media video for creator: ${clientData.name}.

=== CONCEPT: ${concept.name} ===
${blueprintLines || "No blueprint set."}
${examplesSection}
${rulesSection}
${captionSection}
${rejectionSection}

=== TASK ===
Week: ${weekLabel}${dayLabel ? `, ${dayLabel}` : ""}

Generate EXACTLY ${count} completely different script alternatives. Each must have a different hook angle but follow the same concept framework. 80–130 words each. ${langInstruction}

The scripts must sound like ${clientData.name} is talking directly to a friend — not like a copywriter wrote them.
Study the example scripts above carefully and match that exact voice and style.
Avoid every pattern flagged in the rejection history.

Output as JSON array:
[
  { "title": "short title", "hook": "opening hook line", "script": "full script text", "caption": "caption text (different angle from script)" },
  ...
]
Only output the JSON array, nothing else.`.trim();

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      messages: [{ role: "user", content: prompt }],
      system: "You are an expert social media script writer who deeply studies creator voice and rejection patterns. Output only valid JSON as instructed.",
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "[]";

    let drafts: { title: string; hook: string; script: string; caption?: string }[] = [];
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      drafts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      drafts = [];
    }

    for (const d of drafts) {
      const draft = await prisma.scriptDraft.create({
        data: {
          clientId: clientData.id,
          conceptId: concept.id,
          title: d.title || `${concept.name} — ${weekLabel}`,
          hook: d.hook || null,
          script: d.script,
          caption: d.caption || null,
          weekLabel,
          dayLabel: dayLabel || null,
          status: "pending",
          isSavedIdea: false,
        },
        include: {
          concept: { select: { name: true } },
          client: { select: { name: true, color: true } },
        },
      });
      created.push(draft);
    }
  }

  return NextResponse.json(created, { status: 201 });
}
