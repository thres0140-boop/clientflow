import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

const DAY = 86400000;
const DEFAULT_STUCK_DAYS = 4;   // a draft sitting in one stage longer than this = stuck
const DEFAULT_PIPELINE_MIN = 2; // fewer than this many upcoming items = starved pipeline

// Rolling cycle window for a client-owned concept (mirrors Script Tasks' cycle()).
function cycleWindow(anchorStr: string | null, intervalDays: number | null) {
  const interval = Math.max(1, intervalDays || 7);
  const now = Date.now();
  const anchorMs = anchorStr ? new Date(anchorStr + "T00:00:00").getTime() : now - interval * DAY;
  let start = anchorMs;
  let end = anchorMs + interval * DAY;
  while (end <= now) { start = end; end += interval * DAY; }
  while (start > now) { end = start; start -= interval * DAY; }
  return { start, end };
}

// GET /api/hq — owner-only command-center aggregation across all clients.
export async function GET(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.type !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const STUCK_DAYS = Math.max(1, parseInt(req.nextUrl.searchParams.get("stuckDays") || "") || DEFAULT_STUCK_DAYS);
  const PIPELINE_MIN = Math.max(1, parseInt(req.nextUrl.searchParams.get("pipelineMin") || "") || DEFAULT_PIPELINE_MIN);

  const clients = await prisma.client.findMany({
    where: { isTestAccount: { not: true }, hideFromHq: { not: true } } as any,
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  });

  const stages = await prisma.workflowStage.findMany({
    select: { id: true, clientId: true, name: true, order: true },
  });
  const stagesByClient = new Map<number, { id: number; name: string; order: number }[]>();
  for (const s of stages) {
    const arr = stagesByClient.get(s.clientId) || [];
    arr.push(s); stagesByClient.set(s.clientId, arr);
  }

  // Active production drafts (not posted, not parked ideas).
  const drafts = await prisma.scriptDraft.findMany({
    where: { status: { notIn: ["posted"] }, isSavedIdea: false },
    select: {
      id: true, clientId: true, title: true, stageId: true, status: true,
      updatedAt: true, generatedAt: true, scheduledDate: true, clientAuthored: true,
      conceptId: true, hook: true,
      stage: { select: { name: true, order: true } },
      concept: { select: { name: true, conceptType: true } },
    },
  });

  // Client-owned concepts → quota tracking.
  const ownedConcepts = await prisma.concept.findMany({
    where: { clientOwned: true },
    select: { id: true, clientId: true, name: true, clientQuota: true, clientIntervalDays: true, clientAnchor: true },
  });

  const now = Date.now();
  const soon = now + 7 * DAY;

  const blockingMe: any[] = [];
  const clientCards = clients.map((c) => {
    const cDrafts = drafts.filter((d) => d.clientId === c.id);
    const cStages = (stagesByClient.get(c.id) || []).sort((a, b) => a.order - b.order);
    const lastStageName = cStages.length ? cStages[cStages.length - 1].name : null;

    // Stage counts (in-stage drafts) + ideas (no stage yet).
    const stageCounts: Record<string, number> = {};
    let inStage = 0, ideas = 0;
    for (const d of cDrafts) {
      if (d.stageId && d.stage) { stageCounts[d.stage.name] = (stageCounts[d.stage.name] || 0) + 1; inStage++; }
      else ideas++;
    }

    // Stuck = in a stage, untouched > STUCK_DAYS.
    const stuck = cDrafts.filter((d) => d.stageId && (now - new Date(d.updatedAt).getTime()) > STUCK_DAYS * DAY);

    // Awaiting owner review = drafts in a "check" stage (incl. Final Check).
    const awaitingReview = cDrafts.filter((d) => d.stage && /check/i.test(d.stage.name));
    for (const d of awaitingReview) {
      blockingMe.push({
        draftId: d.id, clientId: c.id, clientName: c.name, clientColor: c.color,
        title: d.title, stage: d.stage?.name, ageDays: Math.floor((now - new Date(d.updatedAt).getTime()) / DAY),
        concept: d.concept ? (d.concept.conceptType ? `${d.concept.conceptType} · ${d.concept.name}` : d.concept.name) : null,
      });
    }

    // Quota: how many scripts this client still owes across their client-owned concepts.
    let scriptsDue = 0;
    for (const oc of ownedConcepts.filter((o) => o.clientId === c.id)) {
      const { start, end } = cycleWindow(oc.clientAnchor, oc.clientIntervalDays);
      const done = cDrafts.filter((d) =>
        d.conceptId === oc.id && d.clientAuthored &&
        (() => { const g = new Date(d.generatedAt).getTime(); return g >= start && g < end; })()
      ).length;
      scriptsDue += Math.max(0, (oc.clientQuota || 0) - done);
    }

    // Posting gap = nothing scheduled in the next 7 days.
    const upcoming = cDrafts.filter((d) => {
      if (!d.scheduledDate) return false;
      const t = new Date(d.scheduledDate.includes("T") ? d.scheduledDate : d.scheduledDate + "T00:00:00").getTime();
      return t >= now && t <= soon;
    });
    const postingGap = upcoming.length === 0;
    const pipelineStarved = ideas + inStage < PIPELINE_MIN;

    // Content runway — how far ahead this client is covered with SCHEDULED posts.
    const todayMs = now - (now % DAY); // floor to start of day (UTC-ish, fine for day granularity)
    const allUpcoming = cDrafts.filter((d) => {
      if (!d.scheduledDate) return false;
      const t = new Date(d.scheduledDate.includes("T") ? d.scheduledDate : d.scheduledDate + "T00:00:00").getTime();
      return t >= todayMs;
    });
    const coveredUntilMs = allUpcoming.reduce((mx, d) => {
      const t = new Date(d.scheduledDate!.includes("T") ? d.scheduledDate! : d.scheduledDate! + "T00:00:00").getTime();
      return t > mx ? t : mx;
    }, 0);
    const coveredUntil = coveredUntilMs ? new Date(coveredUntilMs).toISOString().slice(0, 10) : null;
    const runwayDays = coveredUntilMs ? Math.max(0, Math.ceil((coveredUntilMs - todayMs) / DAY)) : 0;
    const scheduledTotal = allUpcoming.length;

    const lastActivityAt = cDrafts.reduce((max, d) => {
      const t = new Date(d.updatedAt).getTime(); return t > max ? t : max;
    }, 0) || null;

    // Build traffic-light signals.
    const signals: { level: "red" | "yellow"; label: string }[] = [];
    if (awaitingReview.length) signals.push({ level: "red", label: `${awaitingReview.length} awaiting your review` });
    if (scriptsDue > 0) signals.push({ level: "red", label: `owes ${scriptsDue} script${scriptsDue > 1 ? "s" : ""}` });
    if (stuck.length) signals.push({ level: "red", label: `${stuck.length} stuck >${STUCK_DAYS}d` });
    if (postingGap) signals.push({ level: "yellow", label: "nothing scheduled (7d)" });
    if (pipelineStarved) signals.push({ level: "yellow", label: "pipeline low" });

    const health: "red" | "yellow" | "green" =
      signals.some((s) => s.level === "red") ? "red" : signals.length ? "yellow" : "green";

    return {
      id: c.id, name: c.name, color: c.color,
      health, signals,
      ideas, inStage, stageCounts, lastStageName,
      stuck: stuck.length, awaitingReview: awaitingReview.length, scriptsDue,
      upcomingPosts: upcoming.length,
      coveredUntil, runwayDays, scheduledTotal,
      lastActivityAt,
    };
  });

  // Sort: most-needy first (red → yellow → green), then by signal count.
  const order = { red: 0, yellow: 1, green: 2 };
  clientCards.sort((a, b) => order[a.health] - order[b.health] || b.signals.length - a.signals.length);
  blockingMe.sort((a, b) => b.ageDays - a.ageDays);

  const summary = {
    total: clientCards.length,
    red: clientCards.filter((c) => c.health === "red").length,
    yellow: clientCards.filter((c) => c.health === "yellow").length,
    green: clientCards.filter((c) => c.health === "green").length,
  };

  // Pipeline distribution across ALL clients (the bottleneck funnel).
  const stageAgg = new Map<string, { count: number; order: number }>();
  stageAgg.set("Ideas", { count: 0, order: -1 });
  for (const d of drafts) {
    if (d.stageId && d.stage) {
      const cur = stageAgg.get(d.stage.name) || { count: 0, order: d.stage.order };
      cur.count++; stageAgg.set(d.stage.name, cur);
    } else {
      const i = stageAgg.get("Ideas")!; i.count++;
    }
  }
  const stageDistribution = Array.from(stageAgg.entries())
    .map(([name, v]) => ({ name, count: v.count, order: v.order }))
    .sort((a, b) => a.order - b.order)
    .filter((s) => s.count > 0 || s.name === "Ideas");

  const totals = {
    awaitingReview: blockingMe.length,
    scriptsDue: clientCards.reduce((s, c) => s + c.scriptsDue, 0),
    stuck: clientCards.reduce((s, c) => s + c.stuck, 0),
    upcomingPosts: clientCards.reduce((s, c) => s + c.upcomingPosts, 0),
    inPipeline: clientCards.reduce((s, c) => s + c.ideas + c.inStage, 0),
  };

  const workload = clientCards
    .map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.ideas + c.inStage, health: c.health }))
    .sort((a, b) => b.count - a.count);

  // Content runway — least-covered clients first (most urgent to feed).
  const runway = clientCards
    .map((c) => ({
      id: c.id, name: c.name, color: c.color,
      runwayDays: c.runwayDays, coveredUntil: c.coveredUntil, scheduled: c.scheduledTotal,
      inProduction: c.ideas + c.inStage,
    }))
    .sort((a, b) => a.runwayDays - b.runwayDays);

  // Recent activity digest.
  let recent: any[] = [];
  try {
    recent = await (prisma as any).activityEvent.findMany({
      orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, clientId: true, actor: true, type: true, title: true, detail: true, createdAt: true },
    });
    const nameById = new Map(clients.map((c) => [c.id, c.name]));
    recent = recent.map((r) => ({ ...r, clientName: r.clientId ? nameById.get(r.clientId) || null : null }));
  } catch { recent = []; }

  return NextResponse.json({ summary, totals, clients: clientCards, blockingMe, recent, charts: { stageDistribution, workload, runway } });
}
