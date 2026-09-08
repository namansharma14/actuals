/**
 * Hosted pages are parked: the sign-in, pairing, account, callback and share routes and their
 * API exist in the code but answer only when HOSTED_ENABLED=1 is set on the deployment. Without
 * it a page renders the site's not-found page and an endpoint answers 404 in one sentence.
 */
export const hostedEnabled = (): boolean => process.env.HOSTED_ENABLED === "1";

const body = JSON.stringify({ error: "Hosted pages are not available yet. Run npx actuals on your own machine." });

/** The 404 an endpoint answers while hosted pages are parked, or null when they are on. */
export function hostedGate(): Response | null {
  if (hostedEnabled()) return null;
  return new Response(body, { status: 404, headers: { "content-type": "application/json; charset=utf-8" } });
}
