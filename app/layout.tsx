import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/shared/auth/session";
import { THEME_PRE_PAINT_SCRIPT } from "@/shared/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ORDO",
  description: "Agency Management by ORDO",
  applicationName: "ORDO",
  appleWebApp: { capable: true, title: "ORDO", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/icons/64",      // ORDO wordmark — browser tab
    shortcut: "/icons/64",
    apple: "/icons/180",    // square icon for iOS home screen
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1c34",
};

// Dark mode is owner-only. The pre-paint script that reads `cf_theme` is injected only
// when the request carries an owner session, so a team member or client account on the
// same browser never gets a dark first paint — whatever localStorage holds. (Reading the
// cookie here makes the root layout dynamic, which it effectively already was: proxy.ts
// verifies the same cookie on every request.)
async function isOwnerRequest(): Promise<boolean> {
  try {
    const token = (await cookies()).get("cf_session")?.value;
    if (!token) return false;
    const session = await verifySessionToken(token);
    return session?.type === "owner";
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const owner = await isOwnerRequest();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {owner && <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />}
        <link rel="stylesheet" href="/excalidraw.css" />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
