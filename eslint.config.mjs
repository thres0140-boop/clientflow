import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Product boundary (editor feedback; the hard gate is scripts/check-db-boundaries.mjs in `npm run build`).
const AGENCY_ONLY_IMPORTS = [
  "@/shared/db/prisma", "@/app/generated/prisma/client", "@/shared/auth/session", "@/shared/auth/cookie",
  "@/shared/auth/permissions", "@/shared/activity", "@/shared/notify/push", "@/shared/media/r2",
  "@/shared/media/mediaCleanup", "@/shared/types", "@/shared/ui/Sidebar", "@/shared/ui/PushToggle",
  "@/features/*", "@/app/api/*", "@/app/page",
];
const AI_ONLY_IMPORTS = ["@/ai/*", "@/app/ai/*", "@/app/generated/prisma-ai/*"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["ai/**", "app/ai/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: AGENCY_ONLY_IMPORTS, message: "AI product code must use its @/ai/** twins (separate database + session)." }] }] },
  },
  {
    files: ["app/**", "features/**", "shared/**"],
    // app/api/admin/migrate/ai-clients is the phase-3 copy bridge (see check-db-boundaries.mjs).
    ignores: ["app/ai/**", "app/api/admin/migrate/ai-clients/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [{ group: AI_ONLY_IMPORTS, message: "Agency code must never import AI product modules." }] }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
