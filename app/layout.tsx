import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/shared/auth/session";
import { THEME_DARK_PRE_PAINT_SCRIPT, THEME_PRE_PAINT_SCRIPT } from "@/shared/theme";
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

// The theme is decided before first paint, from the session cookie, so nobody sees a flash of
// the wrong one. The owner chooses (the script reads `cf_theme`); a team member or client
// account is always dark and has no toggle, so theirs is set outright. Logged out, neither
// script runs and the page is light. (Reading the cookie here makes the root layout dynamic,
// which it effectively already was: proxy.ts verifies the same cookie on every request.)
async function sessionType(): Promise<"owner" | "member" | null> {
  try {
    const token = (await cookies()).get("cf_session")?.value;
    if (!token) return null;
    const session = await verifySessionToken(token);
    return session?.type === "owner" ? "owner" : session ? "member" : null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const type = await sessionType();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {type === "owner" && <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />}
        {type === "member" && <script dangerouslySetInnerHTML={{ __html: THEME_DARK_PRE_PAINT_SCRIPT }} />}
        <link rel="stylesheet" href="/excalidraw.css" />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
