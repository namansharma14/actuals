import type { MetadataRoute } from "next";

/** The pages a stranger can land on: the landing, how to use it, and the live demo. */
export default function sitemap(): MetadataRoute.Sitemap {
  const at = new Date("2026-09-15T00:00:00Z");
  return [
    { url: "https://getactuals.net/", lastModified: at, changeFrequency: "weekly", priority: 1 },
    { url: "https://getactuals.net/how-to-use", lastModified: at, changeFrequency: "weekly", priority: 0.8 },
    { url: "https://getactuals.net/demo", lastModified: at, changeFrequency: "weekly", priority: 0.6 },
  ];
}
