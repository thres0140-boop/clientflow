// The AI-business product's URL slug. ONE constant: change it here and the product moves.
//
//   AI_BASE  — page prefix, e.g. "/ai"        → ordoagency.com/ai, /ai/login, /ai/owner
//   AI_API   — API prefix,  e.g. "/ai/api"    → every AI-side route
//
// The physical folder stays app/ai; when AI_SLUG differs from "ai", next.config.ts rewrites
// /${AI_SLUG}/* to /ai/* and proxy.ts guards both prefixes as the AI namespace.
export const AI_SLUG = "ai";
export const AI_BASE = `/${AI_SLUG}`;
export const AI_API = `${AI_BASE}/api`;
