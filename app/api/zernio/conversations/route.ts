import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;

export const maxDuration = 60;

// GET /api/zernio/conversations?clientId=X
//
// Zernio's GET /v1/inbox/conversations returns at most `limit` (max 100) per call and pages
// with `pagination.nextCursor`. We follow the cursor server-side and return the WHOLE inbox in
// one response (capped at MAX_PAGES), so the client gets a complete, searchable list in one
// round trip. Rationale: a coach's inbox is a few hundred conversations, and search/sort in the
// UI only make sense over the full set. `truncated: true` flags the rare inbox past the cap.
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // 2,000 conversations

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const cid = parseInt(clientId);
  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: cid } });
  if (!conn?.zernioAccountId) return NextResponse.json({ error: "no_zernio_account" }, { status: 200 });

  const profileId = (conn as any).zernioProfileId || PROFILE_ID;
  const all: any[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let meta: any = null;

  do {
    const url = new URL(`${ZERNIO_BASE}/inbox/conversations`);
    url.searchParams.set("profileId", profileId);
    url.searchParams.set("accountId", conn.zernioAccountId);
    url.searchParams.set("platform", "instagram");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("sortOrder", "desc");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" } });
    const data = await res.json();
    if (!res.ok) {
      console.error("[zernio/conversations] Zernio error", res.status, JSON.stringify(data).slice(0, 500), "page", pages + 1);
      // A failure on a later page: return what we have rather than nothing.
      if (all.length) break;
      return NextResponse.json(
        { error: data?.message ?? data?.error ?? "Failed to fetch conversations", zernioStatus: res.status, raw: data },
        { status: res.status === 429 ? 429 : 400 },
      );
    }
    const items: any[] = Array.isArray(data?.data) ? data.data : [];
    // One-time shape check (keys only, no content) so the real field names are visible in logs.
    if (pages === 0 && items[0]) {
      const s = items[0];
      console.log("[zernio/conversations] sample keys:", Object.keys(s).join(","), "| participantPicture:", s.participantPicture ? "set" : "null", "| unreadCount:", s.unreadCount, "| pagination:", JSON.stringify(data?.pagination));
    }
    all.push(...items);
    meta = data?.meta ?? meta;
    cursor = data?.pagination?.hasMore && data?.pagination?.nextCursor ? String(data.pagination.nextCursor) : null;
    pages++;
  } while (cursor && pages < MAX_PAGES);

  // Lead creation + funnel detection is handled by syncClientPipeline (page load + cron).
  return NextResponse.json({ data: all, pagination: { pages, truncated: !!cursor, total: all.length }, meta });
}
