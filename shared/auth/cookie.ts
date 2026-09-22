// Session cookie attributes, shared by every route that writes cf_session.
//
// SameSite=None is required for the cookie to be sent when Ordo runs inside the
// Cenks Dashboard iframe (a cross-site context). Browsers only accept
// SameSite=None together with Secure, which needs HTTPS — so local HTTP dev
// keeps Lax. CSRF exposure from None is limited by the Origin check in proxy.ts.
const isProd = process.env.NODE_ENV === "production";

export const SESSION_COOKIE = "cf_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? ("none" as const) : ("lax" as const),
    maxAge: SESSION_MAX_AGE,
    path: "/",
  };
}
