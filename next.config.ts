import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the end-to-end test server run alongside `npm run dev` without clashing.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // PGlite (local dev database) loads a WebAssembly file at runtime; don't bundle it.
  serverExternalPackages: ["@electric-sql/pglite"],
  cacheComponents: true,
  devIndicators: false,
  // Home opens the calendar.
  async redirects() {
    return [{ source: "/", destination: "/calendar", permanent: false }];
  },
  // Basic hardening: no embedding in other sites, no MIME sniffing, minimal referrers,
  // and no camera/mic/location access.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
