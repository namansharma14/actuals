"use server";

import { addInterest, dbConfigured } from "../../lib/db";

export interface InterestState {
  done?: string;
  error?: string;
}

const SOON = new Set(["pro", "max"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One email, one tier, one row. Nothing is sent: there is no email provider yet, and the
 * row exists so the first mail can go out when the tier does. A bot that fills the hidden
 * field gets the same sentence and no row. A repeat gets the same sentence and no second row.
 */
export async function registerInterest(_prev: InterestState, form: FormData): Promise<InterestState> {
  const tier = String(form.get("tier") ?? "");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const trap = String(form.get("website") ?? "");
  if (!SOON.has(tier)) return { error: "That tier is not on the list." };
  if (email.length > 254 || !EMAIL.test(email)) return { error: "That does not look like an email address." };
  const name = tier === "pro" ? "Pro" : "Max";
  const done = `Noted. One email when ${name} is live, nothing else.`;
  if (trap) return { done };
  if (!dbConfigured()) return { error: "Not configured on this deployment." };
  await addInterest(email, tier);
  return { done };
}
