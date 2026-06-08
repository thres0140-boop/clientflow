import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ORDO",
  description: "Agency Management by ORDO",
  applicationName: "ORDO",
  appleWebApp: { capable: true, title: "ORDO", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/icons/180", // square icon for iOS home screen
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <link rel="stylesheet" href="/excalidraw.css" />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
