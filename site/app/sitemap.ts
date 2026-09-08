import type { MetadataRoute } from "next";

/** The pages a stranger can land on: the landing and how to use it. */
export default function sitemap(): MetadataRoute.Sitemap {
  const at = new Date("2026-09-08T00:00:00Z");
  return [
    { url: "https://getactuals.net/", lastModified: at, changeFrequency: "weekly", priority: 1 },
    { url: "https://getactuals.net/how-to-use", lastModified: at, changeFrequency: "weekly", priority: 0.8 },
  ];
}
