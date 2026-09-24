import type { Metadata } from "next";

// AI-business product shell. Nested inside the root layout (fonts, CSS); only the identity
// differs. Pages and API routes live under app/ai/** and are served at /${AI_SLUG}/** (ai/slug.ts).
export const metadata: Metadata = {
  title: "ORDO AI",
  description: "AI business by ORDO",
  applicationName: "ORDO AI",
  appleWebApp: { capable: true, title: "ORDO AI", statusBarStyle: "black-translucent" },
};

export default function AiLayout({ children }: { children: React.ReactNode }) {
  return children;
}
