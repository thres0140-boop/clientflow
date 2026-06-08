import Anthropic from "@anthropic-ai/sdk";

const SCRAPER_HOST = "instagram-scraper-stable-api.p.rapidapi.com";

export type FoundUser = {
  username: string;
  fullName: string;
  profilePicUrl?: string;
  isPrivate: boolean;
};

// Expand a seed keyword into a niche vocabulary the crawler matches names/usernames against.
export async function expandKeywords(seedKeyword: string): Promise<string[]> {
  const base = [seedKeyword.toLowerCase().trim()].filter(Boolean);
  if (!process.env.ANTHROPIC_API_KEY) return base;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `A user wants to find Instagram competitors in this niche: "${seedKeyword}". Output 12-20 short keywords/terms (single words or short tokens, lowercase) that commonly appear in the USERNAME or display NAME of accounts in this niche (e.g. for "social media": smm, socialmedia, content, creator, agency, marketing, ghostwriter, growth, reels, viral). Output ONLY a JSON array of strings, nothing else.`,
      }],
    });
    const txt = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const arr = JSON.parse(txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1));
    const kws = (Array.isArray(arr) ? arr : []).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
    return Array.from(new Set([...base, ...kws]));
  } catch {
    return base;
  }
}

// Fetch one page of who `handle` FOLLOWS (their curated peers). Returns users + next token.
export async function fetchFollowingPage(handle: string, token?: string): Promise<{ users: FoundUser[]; next: string | null; ok: boolean; error?: string }> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return { users: [], next: null, ok: false, error: "RAPIDAPI_KEY not set" };
  const username = handle.replace(/^@/, "").trim();
  try {
    const body = new URLSearchParams({ username_or_url: username, data: "following", amount: "50" });
    if (token) body.set("pagination_token", token);
    const res = await fetch(`https://${SCRAPER_HOST}/get_ig_user_followers_v2.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-rapidapi-host": SCRAPER_HOST, "x-rapidapi-key": apiKey },
      body: body.toString(),
    });
    const data = await res.json();
    if (data?.detail || data?.error || data?.message) return { users: [], next: null, ok: false, error: String(data.detail || data.error || data.message).slice(0, 150) };
    // Response shape isn't documented — dig through the common containers.
    const rawList: unknown[] = data?.users ?? data?.data?.users ?? data?.followers ?? data?.following ?? data?.data?.items ?? data?.items ?? [];
    const users: FoundUser[] = (rawList as Record<string, unknown>[]).map((u) => {
      const n = (u.user ?? u) as Record<string, unknown>;
      return {
        username: String(n.username ?? n.user_name ?? ""),
        fullName: String(n.full_name ?? n.fullName ?? n.name ?? ""),
        profilePicUrl: (n.profile_pic_url ?? n.profilePicUrl ?? n.profile_pic_url_hd) as string | undefined,
        isPrivate: Boolean(n.is_private ?? n.isPrivate ?? false),
      };
    }).filter((u) => u.username);
    const next = (data?.pagination_token ?? data?.data?.pagination_token ?? data?.next_max_id ?? null) as string | null;
    return { users, next, ok: true };
  } catch (e) {
    return { users: [], next: null, ok: false, error: String(e).slice(0, 150) };
  }
}

// Does a user's username/name contain any of the niche keywords?
export function matchedKeyword(u: FoundUser, keywords: string[]): string | null {
  const hay = `${u.username} ${u.fullName}`.toLowerCase();
  for (const k of keywords) {
    if (k.length >= 2 && hay.includes(k)) return k;
  }
  return null;
}
