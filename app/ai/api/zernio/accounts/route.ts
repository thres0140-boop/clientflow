import { AI_BASE } from "@/ai/slug";
import { NextRequest, NextResponse } from "next/server";

const ZERNIO_BASE = `https://zernio.com${AI_BASE}/api/v1`;
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.AI_ZERNIO_PROFILE_ID!;

// GET /api/zernio/accounts?platform=instagram|tiktok
// Returns all accounts of the given platform connected to this Zernio profile.
// Used so users can pick which account to link to which client.
export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform") || "instagram";
  // profileId: explicit value scopes to one profile; "all" (or omitted for a non-default lookup)
  // returns accounts across every profile — needed because a client's account may live under its
  // own Zernio profile, not the agency default.
  const rawProfile = req.nextUrl.searchParams.get("profileId");
  const qs = new URLSearchParams();
  if (rawProfile && rawProfile !== "all") qs.set("profileId", rawProfile);
  else if (rawProfile == null) qs.set("profileId", PROFILE_ID); // legacy default (Instagram picker)
  qs.set("platform", platform);
  const res = await fetch(
    `${ZERNIO_BASE}/accounts?${qs.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${ZERNIO_KEY}`,
        Accept: "application/json",
      },
    }
  );
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data?.message ?? data?.error ?? JSON.stringify(data), raw: data }, { status: 400 });
  return NextResponse.json(data);
}
