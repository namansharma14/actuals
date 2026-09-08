"use server";

import { revalidatePath } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db, upsertUserByClerkId } from "../../lib/db";
import { hashLicence, newLicenceKey } from "../../lib/licence";
import { revokeLicence } from "../../lib/pairing";

export interface LicenceState {
  key?: string;
  error?: string;
}

/**
 * The quiet path for someone on 0.1.0 who pastes a key by hand: mints one licence row for
 * this account (the same table every upload authenticates against), shows the key once,
 * and never stores it. Pairing is the normal path; this exists for the old command.
 */
export async function issueLicence(_prev: LicenceState, _form: FormData): Promise<LicenceState> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in first." };
  const person = await currentUser();
  const user = await upsertUserByClerkId(
    userId,
    person?.username ?? null,
    person?.emailAddresses?.[0]?.emailAddress ?? null,
  );
  const key = newLicenceKey();
  await db().query(`INSERT INTO hosted.licences (user_id, hash, device) VALUES ($1, $2, $3)`, [
    user.id,
    hashLicence(key),
    "key pasted by hand",
  ]);
  revalidatePath("/account");
  return { key };
}

/** Disconnect one computer. Its licence stops working at once; nothing else changes. */
export async function disconnect(form: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;
  const id = form.get("licence");
  if (typeof id !== "string" || !id) return;
  const person = await currentUser();
  const user = await upsertUserByClerkId(userId, person?.username ?? null, person?.emailAddresses?.[0]?.emailAddress ?? null);
  await revokeLicence(user.id, id);
  revalidatePath("/account");
}
