import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Focus } from "../../components/focus";
import { clerkConfigured } from "../../lib/config";
import { dbConfigured, upsertUserByClerkId } from "../../lib/db";
import { isExpired, normalizeCode, pairingByCode } from "../../lib/pairing";
import { approve, deny } from "./actions";
import { hostedEnabled } from "../../lib/hosted";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect this computer",
  description: "Approve the code your terminal printed, and that computer can make share links. No key to copy.",
  robots: { index: false, follow: false },
};

type Params = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

/** "a moment ago", "2 minutes ago": the code's age, the one fact that tells a phished link from your own. */
function ageOf(iso: Date | string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "a moment ago";
  return `${m} minute${m === 1 ? "" : "s"} ago`;
}

/** The page `actuals login` opens: the code to match, the computer, one button. */
export default async function PairPage({ searchParams }: { searchParams: Params }) {
  if (!hostedEnabled()) notFound();
  const params = await searchParams;
  const code = normalizeCode(one(params.code));
  const justDenied = one(params.denied) === "1";

  if (!clerkConfigured() || !dbConfigured()) {
    return (
      <Focus>
        <h1 className="ac-display ac-display-c">
          <span className="ac-display-s">Connecting is not available here yet.</span>
        </h1>
        <p className="ac-lede ac-center">
          This deployment cannot connect a computer. Everything on your machine still works, and always will.
        </p>
        <Link className="ac-quiet" href="/">
          Back to the start
        </Link>
      </Focus>
    );
  }

  const { userId } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/pair?code=${code ?? ""}`)}`);

  const person = await currentUser();
  const handle = person?.username ?? person?.emailAddresses?.[0]?.emailAddress ?? "signed in";
  const user = await upsertUserByClerkId(userId, person?.username ?? null, person?.emailAddresses?.[0]?.emailAddress ?? null);

  const row = code ? await pairingByCode(code) : null;
  const state = !row
    ? "expired"
    : row.denied_at || justDenied
      ? "denied"
      : row.approved_at
        ? row.user_id === user.id
          ? "connected"
          : "expired"
        : isExpired(row)
          ? "expired"
          : "ready";

  if (state === "expired") {
    return (
      <Focus handle={handle}>
        <h1 className="ac-display ac-display-c">
          <span className="ac-display-s">This code has expired.</span>
        </h1>
        <p className="ac-lede ac-center">
          Run <code>actuals login</code> again for a fresh one. A code lasts ten minutes.
        </p>
        <Link className="ac-quiet" href="/account">
          Go to your account
        </Link>
      </Focus>
    );
  }

  if (state === "denied") {
    return (
      <Focus handle={handle}>
        <h1 className="ac-display ac-display-c">
          <span className="ac-display-s">Not connected.</span>
        </h1>
        <p className="ac-lede ac-center">
          That computer was not connected and its code no longer works. If it was yours after all, run{" "}
          <code>actuals login</code> again.
        </p>
        <Link className="ac-quiet" href="/account">
          Go to your account
        </Link>
      </Focus>
    );
  }

  if (state === "connected") {
    return (
      <Focus handle={handle}>
        <h1 className="ac-display ac-display-c">
          <span className="ac-display-s">Connected.</span>
        </h1>
        <p className="ac-lede ac-center">You can close this tab. Your terminal is set up.</p>
        <Link className="ac-btn" href="/account">
          Go to your account
        </Link>
      </Focus>
    );
  }

  return (
    <Focus handle={handle}>
      <h1 className="ac-display ac-display-c">
        <span className="ac-display-s">Connect this computer?</span>
      </h1>
      <p className="ac-lede ac-center">
        Did you just run <code>actuals login</code> on <strong>{row!.device}</strong>? The code below was issued{" "}
        {ageOf(row!.created_at)}. Check it matches the one in your terminal, then approve it.
      </p>
      <div className="ac-code" aria-label={`code ${row!.code}`}>
        {row!.code}
      </div>
      <p className="ac-code-meta">
        <span>{row!.device}</span>
        {row!.cli ? <span>actuals {row!.cli}</span> : null}
        <span>the code lasts ten minutes</span>
      </p>
      <div className="ac-actions">
        <form action={approve}>
          <input type="hidden" name="code" value={row!.code} />
          <button type="submit" className="ac-btn">
            Connect this computer
          </button>
        </form>
        <form action={deny}>
          <input type="hidden" name="code" value={row!.code} />
          <button type="submit" className="ac-quiet">
            Not me, cancel
          </button>
        </form>
      </div>
      <p className="ac-note ac-center">
        A connected computer can upload a redacted report and a sticker when you ask it to, and nothing else. It cannot
        read your machine, run anything, or send a thing without you. If you did not run the command, cancel: a link
        someone sent you is not yours to approve.
      </p>
    </Focus>
  );
}
