import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Answer } from "../../components/answer";
import { InterestField } from "../../components/interest-field";
import { LicenceKey } from "../../components/licence-key";
import { PlainState } from "../../components/plain-state";
import { Shell } from "../../components/shell";
import { SignOut } from "../../components/sign-out";
import { Standing } from "../../components/standing";
import { StickerGallery } from "../../components/sticker-gallery";
import { WeekLine } from "../../components/week-line";
import { checkoutConfigured, clerkConfigured } from "../../lib/config";
import { COMMAND } from "../../lib/constants";
import { dayOf } from "../../lib/dates";
import { dbConfigured, runsForUser, standing, upsertUserByClerkId, weeksForUser } from "../../lib/db";
import { GO_RUNS_A_MONTH } from "../../lib/meter";
import { BuyButton } from "../pricing/buy-button";
import { ClerkShell } from "../clerk-shell";
import { hostedEnabled } from "../../lib/hosted";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your Actuals account",
  description: "Your licence key, your plan and credits, and every run you have hosted.",
};

const UNAVAILABLE = "Not available here yet.";

function Closed({ line }: { line: string }) {
  return (
    <Shell>
      <div className="ac-page">
        <PlainState title="Hosted pages are not open here." line={line} />
      </div>
    </Shell>
  );
}

export default async function AccountPage() {
  if (!hostedEnabled()) notFound();
  if (!clerkConfigured()) return <Closed line="Signing in is not available on this site yet. Everything on your machine still is." />;
  if (!dbConfigured()) return <Closed line="This site cannot host runs yet. Everything on your machine still works, and always will." />;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const person = await currentUser();
  const handle = person?.username ?? person?.emailAddresses?.[0]?.emailAddress ?? "signed in";
  const user = await upsertUserByClerkId(
    userId,
    person?.username ?? null,
    person?.emailAddresses?.[0]?.emailAddress ?? null,
  );

  const [s, runs, weeks] = await Promise.all([standing(user.id), runsForUser(user.id), weeksForUser(user.id)]);

  const onGo = s.status === "active" && s.tier === "go";
  const unlimited = s.status === "active" && (s.tier === "pro" || s.tier === "max");
  const freeLeft = Math.max(0, s.free_runs - s.lifetime_runs);
  const plan = unlimited ? `${s.tier === "pro" ? "Pro" : "Max"}.` : onGo ? "Go, $9 a month." : "Free plan.";
  const left = unlimited
    ? "Hosted runs are not counted on this plan."
    : onGo
      ? `${Math.max(0, GO_RUNS_A_MONTH - s.runs_this_month)} of ${GO_RUNS_A_MONTH} hosted runs left this month.`
      : `${freeLeft} of five hosted pages left.`;

  return (
    <ClerkShell>
      <Shell signedInAs={handle} signOut={<SignOut />}>
        <div className="ac-page">
          <section className="ac-block">
            <h1 className="ac-display">
              <span className="ac-display-n">{handle}</span>
            </h1>
            <p className="ac-lede">
              Everything on your machine is free and unlimited. This page exists for the runs you chose to host.
            </p>
          </section>

          <LicenceKey
            masked={Boolean(user.licence_hash)}
            issuedAt={user.licence_issued_at ? dayOf(user.licence_issued_at) : null}
          />

          <section className="ac-block">
            <Standing plan={plan} left={left} credits={s.credits} />
            <div className="ac-band ac-upgrade">
              <Answer
                name="Free"
                price="$0"
                current={!onGo && !unlimited}
                lines={["Five hosted share pages, free for the life of the account."]}
              />
              <Answer
                name="Pay as you go"
                price="$1 a page"
                lines={["After the first five, one dollar for each hosted page. Credits do not expire."]}
                action={<BuyButton plan="run" label="Buy credits" enabled={checkoutConfigured("run")} notConfigured={UNAVAILABLE} />}
              />
              <Answer
                name="Go"
                price="$9 a month"
                current={onGo}
                lines={["30 hosted runs a month, share pages, stickers, and your run history in one place."]}
                action={onGo ? undefined : <BuyButton plan="go" label="Start Go" enabled={checkoutConfigured("go")} notConfigured={UNAVAILABLE} />}
              />
            </div>
          </section>

          <section className="ac-block">
            <p className="ac-question">Your share pages.</p>
            <StickerGallery runs={runs} emptyCommand={COMMAND} />
          </section>

          {weeks.length > 0 ? (
            <section className="ac-block">
              <p className="ac-question">Cost per commit, by week.</p>
              <WeekLine weeks={weeks} />
              <p className="ac-note">
                Each point is the newest run you pushed that week, against the newest of the week before. Two reports
                in one week usually cover the same sessions, so weeks are never summed.
              </p>
            </section>
          ) : null}

          <section className="ac-block">
            <p className="ac-note">Pro and Max are not open yet. Leave an address and get one message when they are.</p>
            <InterestField tier="pro" name="Pro" />
          </section>
        </div>
      </Shell>
    </ClerkShell>
  );
}
