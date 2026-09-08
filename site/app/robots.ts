import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/account", "/pair", "/sso-callback", "/r/"] }],
    sitemap: "https://getactuals.net/sitemap.xml",
  };
}
