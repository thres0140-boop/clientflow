# AI-business product — build plan

Two products in one repo and one Vercel deployment:

| | Agency (existing) | AI business (new) |
|---|---|---|
| URL | ordoagency.com/… | ordoagency.com/`AI_SLUG`/… (`AI_SLUG = "ai"`, one constant in `ai/slug.ts`) |
| Database | Neon `STORAGE2_*` (unchanged) | Neon resource `neon-ai-business`, env prefix `AI_` |
| Prisma schema / client | `prisma/schema.prisma` → `app/generated/prisma/client` | `prisma-ai/schema.prisma` → `app/generated/prisma-ai/client` |
| DB access module | `shared/db/prisma.ts` (`prisma`) | `ai/db/prisma.ts` (`prismaAi`) — the only importer of the AI client |
| Session cookie | `cf_session`, secret `SESSION_SECRET`, path `/` | `cf_ai_session`, secret `AI_SESSION_SECRET` (no fallback), path `/ai` |
| Owner login | `/owner`, `OWNER_PASSWORD` | `/ai/owner`, `AI_OWNER_PASSWORD` |
| TikTok | per-client `tiktokEnabled` toggle | always on (toggle hidden, treated as true) |

Decisions fixed by the owner: code is duplicated, not shared; separate databases; separate owner
passwords; TikTok-enabled clients move to the AI side; slug `/ai` as one exported constant.

## The three catastrophic failure modes and the design against each

**1. Cross-database writes.** Three layers, two of them mechanical:
- `ai/db/prisma.ts` is the only module allowed to import `@/app/generated/prisma-ai/client`; it exports
  `prismaAi` and nothing else. `shared/db/prisma.ts` is never imported from AI code.
- Build-time gate `scripts/check-db-boundaries.mjs`, run first in `npm run build` (so Vercel builds fail):
  - any file under `app/ai/**` or `ai/**` importing `shared/db/prisma`, `app/generated/prisma/client`, or an
    agency server module (`shared/activity`, `shared/notify/push`, `shared/media/r2`, `shared/media/mediaCleanup`,
    `shared/auth/session`, `shared/auth/permissions`, `shared/auth/cookie`) → build fails;
  - any file outside `ai/**`/`app/ai/**` importing `ai/**` or `prisma-ai` → build fails;
  - any file other than `ai/db/prisma.ts` importing `app/generated/prisma-ai/client` → build fails.
- ESLint `no-restricted-imports` overrides mirror the same rules for editor feedback.

**2. Shared session cookie.** Different cookie name (`cf_ai_session`) AND different HS256 secret
(`AI_SESSION_SECRET`, required, no dev fallback). A token from either side fails `jwtVerify` on the other.
The AI cookie is scoped to `path=/ai`, so browsers never even send it to agency routes. `proxy.ts` branches
on the path prefix first: under `/ai` only the AI cookie/secret is consulted; elsewhere only the agency one.
Member `clientId` scoping is preserved on both sides.

**3. Destructive migration.** Phase 3 copies rows into the empty AI database with ids preserved and
deletes nothing from the agency database.

## Phase 1 deliverables (this commit)

- `prisma-ai/schema.prisma` — copy of the agency schema; only the generator output and datasource env
  names differ (verified by diff).
- `prisma-ai/init.sql` — full DDL for an empty database, generated offline with
  `prisma migrate diff --from-empty`. 31 tables, 20 indexes/uniques, 34 foreign keys.
- `package.json`: `build` generates both clients; `db:ai:generate`, `db:ai:init-sql`, `db:ai:diff`.
- `.gitignore`: `/app/generated/prisma-ai`.
- Neon resource `neon-ai-business` (free plan) connected to the project with prefix `AI_` → env vars
  `AI_POSTGRES_PRISMA_URL`, `AI_POSTGRES_URL_NON_POOLING`, `AI_DATABASE_URL`, … (see status in the report).

## How the new database gets its schema, and how future changes are applied

This project does not use `prisma migrate`; the agency side ships schema changes through
`POST /api/admin/migrate` (hand-written `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), which
only covers tables added after the initial `db push`. For the AI side:

- **Bootstrap (once):** apply `prisma-ai/init.sql` to the empty AI database via the Neon SQL editor (or
  `psql`). It is the exact DDL Prisma derives from the schema, so client and database match by construction.
- **Future changes:** edit `prisma-ai/schema.prisma`, run `npm run db:ai:diff` (needs
  `AI_POSTGRES_URL_NON_POOLING` in the shell) to get the delta DDL, review it, save it as
  `prisma-ai/migrations/<timestamp>-<name>.sql`, and apply it via `POST /ai/api/admin/migrate?token=…`
  (Phase 2 route: runs each not-yet-applied file inside a transaction and records it in `_ai_migrations`).
  This keeps the "apply by hitting a token-guarded route" workflow the owner already uses, but with
  generated DDL instead of hand-written SQL.

## File-by-file plan (Phase 2)

Layout: pages under `app/ai/**`, API under `app/ai/api/**`, code under `ai/**`.

### Duplicated (copied, then bound to the AI client / cookie / slug)
- `app/page.tsx` → `app/ai/page.tsx`; `app/login`, `app/owner`, `app/invite/[token]`, `app/review/[token]`,
  `app/upload/[token]` → same under `app/ai/`. `app/ai/layout.tsx` sets the AI title/manifest (nested inside
  the root layout, which only provides fonts and CSS).
- `features/**` (32 files) → `ai/features/**`. Mechanical transform: relative `fetch("/api/…")` calls
  (305 sites) go through `aiFetch()` from `ai/api.ts`, which prefixes `/${AI_SLUG}`; `/login` and `/`
  navigations go through `aiPath()`. `/api/img` and `/api/vid` stay as-is (shared public proxies).
- `shared/` product modules → `ai/shared/`: `auth/session.ts` (AI secret), `auth/cookie.ts` (AI name/path),
  `auth/permissions.ts` (AI cookie + `prismaAi`), `db/prisma.ts` (AI client + `AI_POSTGRES_PRISMA_URL`),
  `activity.ts`, `notify/push.ts`, `media/r2.ts` (AI bucket env), `media/mediaCleanup.ts`, `types.ts`,
  `ui/Sidebar.tsx` (TikTok always on), `ui/PushToggle.tsx` (calls the AI push route).
- API routes: 141 route files minus the dead set below → `app/ai/api/**`, every one importing `prismaAi`.
  Cookie/secret/URL literals rewritten: login/logout/me, instagram OAuth (redirect URI `…/ai/api/auth/instagram/callback`),
  tiktok OAuth (`…/ai/api/auth/tiktok/callback`), zernio connect/callback, webhooks, r2 presign/multipart/setup-cors
  (AI bucket), push subscribe.
- `proxy.ts`: one file, two independent namespaces (see failure mode 2). `PUBLIC` gets its `/ai/…` twins.
- `next.config.ts`: when `AI_SLUG !== "ai"`, a rewrite from `/${AI_SLUG}/:path*` to `/ai/:path*` so the
  physical folder never needs renaming.
- `vercel.json`: Phase 4 (AI crons).

### Not duplicated — genuinely shared infrastructure
| File | Why sharing is safe |
|---|---|
| `proxy.ts`, `next.config.ts`, `package.json`, `tsconfig.json`, `eslint.config.mjs` | one deployment; the proxy is the single place that must know both namespaces |
| `app/layout.tsx`, `app/globals.css` | fonts and design tokens only; no data, no auth |
| `app/icons/[size]/route.tsx`, `public/**` (`sw.js`, `play.html`, `ffmpeg/*` incl. the 32 MB wasm) | static assets; the service worker only shows the notification payload it is given |
| `app/api/img`, `app/api/vid` | stateless public proxies, no DB, no cookie |
| `shared/platforms.ts`, `shared/dayTemplate.ts`, `shared/media/videoSrc.ts`, `shared/theme.ts`, `shared/useLiveTheme.ts`, `shared/embed.ts` | pure functions / browser-only helpers, no DB, env or cookie |
| `shared/ui/Modal.tsx`, `StatusBadge.tsx`, `ClientAvatar.tsx` | presentational, no fetch |
| `shared/notify/notify.ts` | Twilio WhatsApp to the same owner phone; env is per operator, not per product |
| `shared/auth/adminToken.ts` | one maintenance token for one operator (`ADMIN_TOKEN`) |

### Dead code proposed NOT to be duplicated (needs owner confirmation)
`app/api/unipile/*` (7 routes, no UI caller; only `sync-followers` still runs as an agency cron),
`app/api/instagram/{publish,conversations,conversations/[id],send-message,oembed,competitor-reels,debug}`,
`app/api/upload`, `app/api/upload-raw`, `app/api/blob/*` (Vercel Blob legacy), `app/api/import-extract`
(Cloudinary-only), `app/api/debug`, `app/api/admin/purge-cloudinary`, `components/pages/*`, `app/play`
(superseded by `public/play.html`). The agency-side admin `GET` debug console is not copied either; the AI
admin route is only the migrations runner.

## Environment variables

New (AI side only): `AI_POSTGRES_PRISMA_URL`, `AI_POSTGRES_URL_NON_POOLING` (+ the other `AI_*` Neon vars),
`AI_SESSION_SECRET`, `AI_OWNER_PASSWORD`, `AI_OWNER_NAME`, `AI_OWNER_EMAIL`, `AI_R2_BUCKET`,
`AI_R2_PUBLIC_BASE_URL`, `AI_ZERNIO_PROFILE_ID`, `AI_INSTAGRAM_REDIRECT_URI`.

Third-party credentials:
| Service | Shared? | Note |
|---|---|---|
| Anthropic, OpenAI, RapidAPI, Resend, Twilio, VAPID push keys, ADMIN_TOKEN | shared | per-operator keys; usage is metered together |
| Cloudflare R2 account + access keys | shared | **bucket must be separate** (`AI_R2_BUCKET`, `AI_R2_PUBLIC_BASE_URL`): object keys are id-based (`comp-videos/<reelId>.mp4`, `comp-examples/<id>.mp4`) and ids are preserved in the copy, so a shared bucket would overwrite the other product's files. Copied rows keep their agency-bucket URLs, which stay readable; AI-side cleanup only deletes URLs under its own public base, so it can never delete agency objects. The new bucket needs the same CORS allowlist (`/ai/api/r2/setup-cors`). |
| Zernio API key | shared | per-profile ids are stored per client (`InstagramConnection.zernioProfileId`, `Client.tiktokZernioProfileId`) and travel with the copy; the env default becomes `AI_ZERNIO_PROFILE_ID`. **Flag:** Zernio delivers post webhooks to a configured URL. If that is one URL per Zernio account/profile, register `/ai/api/webhooks/zernio` for the AI profile. If it is one URL per API key, an AI client's publish event would hit the agency webhook, whose fallback matching (caption prefix, ±3h/±6h) could mark and purge an agency draft — the agency webhook would then need to ignore events whose account id is not agency-linked. Needs checking in the Zernio dashboard before Phase 2 wires webhooks. |
| Meta / Instagram app | shared | add `https://www.ordoagency.com/ai/api/auth/instagram/callback` to the app's valid OAuth redirect URIs (dashboard step) |
| TikTok app (Login Kit) | shared | add `https://www.ordoagency.com/ai/api/auth/tiktok/callback` as a redirect URI (dashboard step); currently hard-coded in `features/tiktok/server/tiktokOAuth.ts` |
| Calendly / Cal.com booking webhook | per side | point the AI clients' booking tools at `/ai/api/webhooks/booking` |
| Unipile, Vercel Blob, Cloudinary | not needed | dead on the agency side; not duplicated |

## Phase 3 preview (copy graph, ids preserved)
Copy order respects foreign keys: Workspace → Client → InstagramConnection, Creator, TeamMember, WorkflowStage,
Board, Competitor → CompetitorReel → CompetitorReelSnapshot, CompetitorCandidate, Concept → ConceptExample,
ScriptDraft → DraftNote, DraftChange, DraftReview, ContentPiece → StageHistory, Notification, TrackedVideo,
AnalyticsEntry, DmLead, Message, ConceptFeedback, ActivityEvent, ReelSnapshot, TikTokInstructions,
TikTokVideoConcept, TikTokDailySnapshot, PushSubscription (member subs for those clients). Global rows
(`clientId IS NULL` concepts/stages) are copied too. Sequences are reset to `max(id)+1` afterwards.

## Phase 4 preview
Eight `/ai/api/cron/*` entries added to `vercel.json` (same schedules), or a single AI dispatcher cron;
decided in Phase 4.
