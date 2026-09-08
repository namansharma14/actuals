import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { Focus } from "../../components/focus";
import { ClerkShell } from "../clerk-shell";
import { notFound } from "next/navigation";
import { hostedEnabled } from "../../lib/hosted";

export const dynamic = "force-dynamic";

/**
 * Where GitHub sends the person back. Clerk finishes the sign-in here, creating the
 * account when it is a first visit, then sends them on to where they were headed.
 */
export default function SsoCallbackPage() {
  if (!hostedEnabled()) notFound();
  return (
    <ClerkShell>
      <Focus>
        <p className="ac-lede ac-center">Signing you in…</p>
        <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/account" signUpFallbackRedirectUrl="/account" />
      </Focus>
    </ClerkShell>
  );
}
