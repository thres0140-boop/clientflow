import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/ai/db/prisma";
import { verifySessionToken } from "@/ai/shared/auth/session";
import { enrichReels } from "@/app/ai/api/instagram/media/route";

export const runtime = "nodejs";
export const maxDuration = 300;

const DAY = 86400000;
const FIELDS = "id,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count";

// GET /api/hq/momentum?period=week|month — per-client performance vs their OWN previous
// period. Compares avg views of reels POSTED in the current window vs the window before it,
// so you see who's trending up (green) or down (red), apples-to-apples per client.
export async function GET(req: NextRequest) {
  const token = req.cookies.get("cf_ai_session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.type !== "owner") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const period = req.nextUrl.searchParams.get("period") === "week" ? "week" : "month";
  const span = period === "week" ? 7 : 30;
  const up = (Math.max(0, parseInt(req.nextUrl.searchParams.get("up") || "") || 10)) / 100;
  const down = (Math.max(0, parseInt(req.nextUrl.searchParams.get("down") || "") || 10)) / 100;
  const now = Date.now();
  const curStart = now - span * DAY;
  const prevStart = now - 2 * span * DAY;

  const clients = await prisma.client.findMany({
    where: { hideFromHq: { not: true } } as any,
    select: { id: true, name: true, color: true, instagramConnection: { select: { accessToken: true } } },
    orderBy: { name: "asc" },
  });

  const results = await Promise.all(clients.map(async (c) => {
    const accessToken = (c as any).instagramConnection?.accessToken;
    const base = { id: c.id, name: c.name, color: c.color };
    if (!accessToken) return { ...base, health: "gray", note: "not connected" };
    try {
      // Page through media until we're older than the previous window (or hit a safety cap).
      let url: string | null = `https://graph.instagram.com/v21.0/me/media?fields=${FIELDS}&limit=50&access_token=${accessToken}`;
      const raw: any[] = [];
      for (let page = 0; page < 6 && url; page++) {
        const res: any = await fetch(url).then((r) => r.json());
        if (!res?.data) break;
        raw.push(...res.data);
        const oldest = res.data.length ? new Date(res.data[res.data.length - 1].timestamp).getTime() : 0;
        if (oldest && oldest < prevStart) break;
        url = res.paging?.next || null;
      }
      const reels = raw.filter((m: any) => m.media_type === "VIDEO" || m.media_type === "REEL" || m.media_product_type === "REELS");
      const windowReels = reels.filter((r: any) => { const t = new Date(r.timestamp).getTime(); return t >= prevStart && t <= now; });
      const enriched = await enrichReels(windowReels, accessToken);

      const cur = enriched.filter((r: any) => { const t = new Date(r.timestamp).getTime(); return t >= curStart; });
      const prev = enriched.filter((r: any) => { const t = new Date(r.timestamp).getTime(); return t >= prevStart && t < curStart; });
      const avg = (arr: any[]) => arr.length ? Math.round(arr.reduce((s, r) => s + (r.plays || 0), 0) / arr.length) : 0;
      const curAvg = avg(cur), prevAvg = avg(prev);

      let health = "gray";
      let delta: number | null = null;
      if (prev.length && cur.length && prevAvg > 0) {
        delta = (curAvg - prevAvg) / prevAvg;
        health = delta >= up ? "green" : delta <= -down ? "red" : "yellow";
      }
      return { ...base, health, delta, curAvg, prevAvg, curCount: cur.length, prevCount: prev.length };
    } catch {
      return { ...base, health: "gray", note: "error" };
    }
  }));

  // Worst first (declining clients surface), then flat, then improving, gray last.
  const order: Record<string, number> = { red: 0, yellow: 1, green: 2, gray: 3 };
  results.sort((a: any, b: any) => (order[a.health] - order[b.health]) || ((a.delta ?? 0) - (b.delta ?? 0)));

  return NextResponse.json({ period, clients: results });
}
