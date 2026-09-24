// Session cookie attributes for the AI product, shared by every route that writes cf_ai_session.
//
// SameSite=None is required for the cookie to be sent when Ordo runs inside the
// Cenks Dashboard iframe (a cross-site context). Browsers only accept
// SameSite=None together with Secure, which needs HTTPS — so local HTTP dev
// keeps Lax. CSRF exposure from None is limited by the Origin check in proxy.ts.
const isProd = process.env.NODE_ENV === "production";

import { AI_BASE } from "@/ai/slug";

// AI product cookie: its own NAME (so an agency token is never even looked at here) and
// its own PATH (so browsers never send it to agency routes).
export const SESSION_COOKIE = "cf_ai_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? ("none" as const) : ("lax" as const),
    maxAge: SESSION_MAX_AGE,
    path: AI_BASE,
  };
}
