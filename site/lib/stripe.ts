/**
 * Stripe, kept small. Checkout creates the session; the webhook is the only writer of
 * subscription state and the only place a credit is granted, because a success URL can be
 * forged and a paying customer may never load it.
 */
import Stripe from "stripe";
import { PRICE_ENV, priceId, type PriceKey } from "./config";

let cached: Stripe | null = null;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set on this deployment");
  cached ??= new Stripe(key);
  return cached;
}

export const TIER_OF_PRICE = (): Record<string, "go" | "pro" | "max"> => {
  const map: Record<string, "go" | "pro" | "max"> = {};
  for (const tier of ["go", "pro", "max"] as const) {
    const id = priceId(tier);
    if (id) map[id] = tier;
  }
  return map;
};

export const priceEnvName = (key: PriceKey): string => PRICE_ENV[key];
