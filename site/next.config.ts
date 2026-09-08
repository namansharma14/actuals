import type { NextConfig } from "next";

/* the old app paths land on the account while hosted is on; while it is parked the account is a 404, so they
   land on the landing (temporary, so a browser does not keep the parked answer) */
const appHome = process.env.HOSTED_ENABLED === "1" ? "/account" : "/";

/**
 * The site renders the CLI's own report with the CLI's own renderer: app code imports
 * `../src/render/html.ts` from the repository root, so webpack needs permission to compile
 * outside this directory and the ESM `.js` specifiers those files use have to resolve to
 * their `.ts` sources.
 */
const config: NextConfig = {
  experimental: { externalDir: true },
  /* the addresses the outreach material carries (v1's pages) land on the page that replaced them; pricing lives on
     the landing now */
  async redirects() {
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/demo.html", destination: "/demo", permanent: true },
      { source: "/start", destination: "/", permanent: true },
      { source: "/start.html", destination: "/", permanent: true },
      { source: "/onboard", destination: "/", permanent: true },
      { source: "/onboard.html", destination: "/", permanent: true },
      { source: "/app", destination: appHome, permanent: false },
      { source: "/app.html", destination: appHome, permanent: false },
      { source: "/app/:view", destination: appHome, permanent: false },
      { source: "/pricing", destination: "/", permanent: true },
    ];
  },
  /* the retired v1 API endpoints answer 410 with one sentence (never the Stripe webhook, which is edited in place) */
  async rewrites() {
    return [
      { source: "/api/waitlist", destination: "/api/gone" },
      { source: "/api/portal/:path*", destination: "/api/gone" },
    ];
  },
  // Two lockfiles sit above this directory; the app is the root for file tracing.
  outputFileTracingRoot: __dirname,
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return cfg;
  },
};

export default config;
