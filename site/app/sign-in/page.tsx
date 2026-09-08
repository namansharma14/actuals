import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Focus } from "../../components/focus";
import { clerkConfigured } from "../../lib/config";
import { ClerkShell } from "../clerk-shell";
import { GitHubButton } from "./github-button";
import { hostedEnabled } from "../../lib/hosted";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in to Actuals",
  description: "Sign in with GitHub to connect a computer and manage hosted runs. The command itself needs no account.",
  robots: { index: false, follow: false },
};

/** Only a path on this site is followed, so the query cannot send anyone off it. */
function safeBack(value: string | string[] | undefined): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/account";
}

/**
 * Sign-in is a step, never a destination: it gets a GitHub identity and returns the person
 * to where they were headed. Clerk's own panel is never shown; one button calls the GitHub
 * strategy directly.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!hostedEnabled()) notFound();
  const params = await searchParams;
  const back = safeBack(params.redirect_url);
  const forPair = back.startsWith("/pair");

  if (!clerkConfigured()) {
    return (
      <Focus>
        <h1 className="ac-display ac-display-c">
          <span className="ac-display-s">Signing in is not available here yet.</span>
        </h1>
        <p className="ac-lede ac-center">Everything on your machine still works, and always will.</p>
        <Link className="ac-quiet" href="/">
          Back to the start
        </Link>
      </Focus>
    );
  }

  const { userId } = await auth();
  if (userId) redirect(back);

  return (
    <ClerkShell>
      <Focus>
        {forPair ? <p className="ac-note ac-center">Sign in to connect this computer. It takes one click.</p> : null}
        <h1 className="ac-display ac-display-c">
          <span className="ac-display-s">Sign in with GitHub.</span>
        </h1>
        <p className="ac-lede ac-center">
          You only need an account to turn a report into a link other people can open. The command itself needs
          nothing: no account, no upload, no model call.
        </p>
        <p className="ac-note ac-center">We read your GitHub username and email to make the account. Nothing else, and never your code.</p>
        <GitHubButton back={back} />
      </Focus>
    </ClerkShell>
  );
}
