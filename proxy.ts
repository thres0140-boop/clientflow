import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

function getSecret() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET || "clientflow-dev-secret-change-in-production"
  );
}

const PUBLIC = ["/login", "/owner", "/invite", "/api/auth", "/api/unipile/webhook", "/api/unipile/callback", "/api/unipile/sync-followers", "/api/upload", "/upload", "/api/upload-tokens", "/api/upload-raw", "/api/blob/upload", "/api/zernio/callback", "/api/admin/migrate", "/api/admin/purge-cloudinary", "/api/cron/", "/api/webhooks/", "/manifest.webmanifest", "/icons/", "/favicon.png", "/logo.png", "/api/img", "/api/vid", "/api/r2/setup-cors", "/sw.js", "/review", "/play.html", "/tiktok"];

// Origins allowed to make state-changing API calls with the session cookie. The cookie is
// SameSite=None (so Ordo works inside the Cenks Dashboard iframe), which means the browser
// attaches it to cross-site requests too — this check is what keeps other sites from
// driving the API with it. Server-to-server callers (crons, webhooks) send no Origin.
const SELF_ORIGINS = ["https://www.ordoagency.com", "https://ordoagency.com", "http://localhost:3000"];
function allowedOrigins(req: NextRequest): string[] {
  const extra = (process.env.EMBED_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [req.nextUrl.origin, ...SELF_ORIGINS, ...extra];
}

// Unauthenticated → /login, carrying the embed flag and the requested screen so that the
// dashboard's deep links (and embedded mode) survive the sign-in round trip.
function loginRedirect(req: NextRequest) {
  const url = new URL("/login", req.url);
  const { pathname, search, searchParams } = req.nextUrl;
  if (searchParams.get("embed") === "1") url.searchParams.set("embed", "1");
  if (!pathname.startsWith("/api/") && (pathname !== "/" || search)) url.searchParams.set("next", pathname + search);
  return url;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    if (origin && !allowedOrigins(req).includes(origin)) {
      return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
    }
  }

  // Canonical host. R2 only accepts browser uploads from ordoagency.com — anyone who
  // opened the app via the raw *.vercel.app deployment URL (or any other host) is on an
  // origin R2 blocks, so their large uploads die with a CORS/network error while the owner
  // (on the real domain) works. Funnel every non-canonical host to www so everyone lands
  // on the allowed origin.
  const host = (req.headers.get("host") || "").toLowerCase();
  const canonical = host === "www.ordoagency.com" || host === "ordoagency.com"
    || host.startsWith("localhost") || host.startsWith("127.0.0.1") || host === "";
  if (!canonical) {
    const url = new URL(req.url);
    url.host = "www.ordoagency.com";
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") return NextResponse.next();

  const token = req.cookies.get("cf_session")?.value;
  if (!token) return NextResponse.redirect(loginRedirect(req));

  try {
    const { payload } = await jwtVerify(token, getSecret());

    // Data isolation: a member may only touch their own client's data. If a member
    // session carries a clientId and an /api request asks for a DIFFERENT clientId,
    // block it. (Owners are unrestricted; older tokens without clientId are skipped
    // and re-scoped on next login.)
    if (
      pathname.startsWith("/api/") &&
      (payload as any).type === "member" &&
      (payload as any).clientId != null
    ) {
      const reqClient = req.nextUrl.searchParams.get("clientId");
      // A member may access ANY project they're on (shared-email grouping). Old tokens
      // without clientIds fall back to the single clientId.
      const allowed: number[] = Array.isArray((payload as any).clientIds) && (payload as any).clientIds.length
        ? (payload as any).clientIds
        : [(payload as any).clientId];
      if (reqClient && !allowed.includes(parseInt(reqClient))) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }
    return NextResponse.next();
  } catch {
    const res = NextResponse.redirect(loginRedirect(req));
    res.cookies.delete("cf_session");
    return res;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|excalidraw.css|favicon.ico).*)"],
};
