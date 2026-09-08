/** One shape for every API answer, so the CLI can print the message and stop. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function fail(status: number, error: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, message, ...extra }, status);
}

export function siteOrigin(req: Request): string {
  const env = process.env.SITE_ORIGIN;
  if (env) return env.replace(/\/$/, "");
  // Only production may claim the production domain: this project's production domain is
  // still the v1 site, so a preview must link to its own deployment URL.
  const vercel =
    process.env.VERCEL_ENV === "production"
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
      : process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return new URL(req.url).origin;
}
