/**
 * The retired v1 endpoints (`/api/waitlist`, `/api/portal/*`) answer 410 in plain words instead of
 * redirecting: a redirect would turn a POST into a GET. Wired by the rewrites in next.config.ts.
 */
const body = JSON.stringify({ error: "This endpoint no longer exists. Run npx actuals on your own machine instead." });
const gone = () => new Response(body, { status: 410, headers: { "content-type": "application/json; charset=utf-8" } });

export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
