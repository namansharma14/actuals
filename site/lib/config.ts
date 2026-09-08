/**
 * A deployment says what it can do. Anything missing turns its surface off with a sentence
 * rather than failing the build, so the landing page and the report still stand on a
 * deployment with no keys at all.
 */
/**
 * The keys are checked for shape, not just presence. `vercel env pull` writes the string
 * "[SENSITIVE]" for values it is not allowed to decrypt, and a surface that trusted that
 * placeholder would fail at request time instead of saying it is not configured.
 */
/**
 * Clerk publishable keys are public by design (the v1 site ships them in web/config.js).
 * The Vercel project marks every variable Sensitive, which keeps a NEXT_PUBLIC_ value out
 * of a build made on a laptop, so the known keys are the fallback: the live one when the
 * deployment is production, the test instance's otherwise. The secret key is read at
 * runtime and never falls back.
 */
const PUBLISHABLE_KEYS = {
  production: "pk_live_Y2xlcmsuZ2V0YWN0dWFscy5uZXQk",
  other: "pk_test_bm90YWJsZS1rb2FsYS0xOS5jbGVyay5hY2NvdW50cy5kZXYk",
} as const;

export function clerkPublishableKey(): string {
  const fromEnv = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  if (/^pk_(test|live)_/.test(fromEnv)) return fromEnv;
  return process.env.VERCEL_ENV === "production" ? PUBLISHABLE_KEYS.production : PUBLISHABLE_KEYS.other;
}

export const clerkConfigured = (): boolean =>
  /^pk_(test|live)_/.test(clerkPublishableKey()) &&
  /^sk_(test|live)_/.test(process.env.CLERK_SECRET_KEY ?? "");

export const stripeConfigured = (): boolean => /^(sk|rk)_(test|live)_/.test(process.env.STRIPE_SECRET_KEY ?? "");

export const PRICE_ENV = {
  go: "STRIPE_PRICE_GO",
  pro: "STRIPE_PRICE_PRO",
  max: "STRIPE_PRICE_MAX",
  run: "STRIPE_PRICE_RUN",
} as const;

export type PriceKey = keyof typeof PRICE_ENV;

export function priceId(key: PriceKey): string | null {
  const value = process.env[PRICE_ENV[key]] ?? "";
  return /^price_/.test(value) ? value : null;
}

export function checkoutConfigured(key: PriceKey): boolean {
  return stripeConfigured() && Boolean(priceId(key));
}

export const NOT_CONFIGURED = "checkout not configured on this deployment";
