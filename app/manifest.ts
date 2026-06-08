import type { MetadataRoute } from "next";

// PWA manifest — makes ORDO installable ("Install app" in Chrome, "Add to Home Screen"
// on iOS) so it lands in the dock / home screen as its own app window.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ORDO",
    short_name: "ORDO",
    description: "Agency Management by ORDO",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1c34",
    theme_color: "#0f1c34", // match the dark sidebar so the app title bar blends in
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
