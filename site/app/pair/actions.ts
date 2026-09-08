"use server";

import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { upsertUserByClerkId } from "../../lib/db";
import { approvePairing, denyPairing, normalizeCode } from "../../lib/pairing";

function codeFrom(form: FormData): string | null {
  const raw = form.get("code");
  return typeof raw === "string" ? normalizeCode(raw) : null;
}

/** The person's one click. The page re-renders in its new state. */
export async function approve(form: FormData): Promise<void> {
  const code = codeFrom(form);
  if (!code) redirect("/pair");
  const { userId } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/pair?code=${code}`)}`);
  const person = await currentUser();
  const user = await upsertUserByClerkId(userId, person?.username ?? null, person?.emailAddresses?.[0]?.emailAddress ?? null);
  await approvePairing(code, user.id);
  redirect(`/pair?code=${encodeURIComponent(code)}`);
}

export async function deny(form: FormData): Promise<void> {
  const code = codeFrom(form);
  if (!code) redirect("/pair");
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  await denyPairing(code);
  redirect(`/pair?code=${encodeURIComponent(code)}&denied=1`);
}
