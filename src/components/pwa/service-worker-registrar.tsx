"use client";

// Registers the service worker (public/sw.js) once, after mount. Only in
// production builds — a SW in `next dev` intercepts /_next/static and
// fights HMR. Rendered from the root layout. Renders nothing.

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[pwa] service worker registration failed:", err);
      });
    };

    // Register after load so it never competes with first paint / hydration.
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
