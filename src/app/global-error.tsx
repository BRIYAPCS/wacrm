"use client";

// Last-resort boundary: catches errors thrown in the ROOT layout itself
// (where the normal error.tsx boundaries can't reach). It replaces the
// entire document, so it renders its own <html>/<body> and uses inline
// styles only — Tailwind/globals.css and the theme provider may not be
// available at this point. Keep it dependency-free so the fallback can
// never itself fail to render.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          color: "#e2e8f0",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "#7c3aed",
              margin: "0 auto 1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: "1.15rem", margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#94a3b8", fontSize: "0.9rem", margin: "0 0 1.25rem" }}>
            The app hit an unexpected error. Try again — if it keeps happening,
            reload the page.
          </p>
          {error?.digest && (
            <p style={{ color: "#64748b", fontSize: "0.72rem", margin: "0 0 1.25rem" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              background: "#7c3aed",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "0.55rem 1.1rem",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
