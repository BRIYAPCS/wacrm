import type { MetadataRoute } from "next";

// Web App Manifest (Next.js metadata convention — served at
// /manifest.webmanifest, and Next auto-injects the <link rel="manifest">).
// Together with the service worker (public/sw.js) and the 192/512 icons,
// this makes wacrm installable to a phone/desktop home screen and gives it
// a native-app splash + standalone chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "wacrm — WhatsApp CRM",
    short_name: "wacrm",
    description:
      "Self-hostable CRM for WhatsApp — shared inbox, contacts, pipelines, broadcasts, and automations.",
    // Land in the app; unauthenticated sessions redirect to /login.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    // Match the app's dark chrome so there's no color flash on launch.
    background_color: "#020617",
    theme_color: "#020617",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
