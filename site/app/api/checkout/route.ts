/**
 * POST /api/checkout, from the pricing page. Signed in, one plan or a number of run
 * credits, and a Checkout Session back. The redirect grants nothing: the webhook does.
 */
import { auth, currentUser } from "@clerk/nextjs/server";
import { NOT_CONFIGURED, checkoutConfigured, clerkConfigured, priceId, type PriceKey } from "../../../lib/config";
import { dbConfigured, db, upsertUserByClerkId } from "../../../lib/db";
import { fail, json, siteOrigin } from "../../../lib/http";
import { stripe } from "../../../lib/stripe";
import { hostedGate } from "../../../lib/hosted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANS: PriceKey[] = ["go", "run"];
// Pro and Max are coming soon at launch (2026-09-06): no checkout, an interest row instead.
const SOON = ["pro", "max"];

interface CustomerRow {
  stripe_customer_id: string | null;
}

export async function POST(req: Request): Promise<Response> {
  const parked = hostedGate();
  if (parked) return parked;
  if (!clerkConfigured() || !dbConfigured()) return fail(503, "not_configured", NOT_CONFIGURED);
  const { userId } = await auth();
  if (!userId) return fail(401, "signed_out", "sign in first");

  const body = (await req.json().catch(() => ({}))) as { plan?: string; quantity?: number };
  if (SOON.includes(String(body.plan))) {
    return fail(400, "not_for_sale", "Pro and Max are not for sale yet. Leave an email on /pricing and we will write once when they are.");
  }
  const plan = PLANS.find((p) => p === body.plan);
  if (!plan) return fail(400, "bad_plan", "plan must be one of go, run");
  if (!checkoutConfigured(plan)) return fail(503, "not_configured", NOT_CONFIGURED);

  const price = priceId(plan);
  if (!price) return fail(503, "not_configured", NOT_CONFIGURED);

  const person = await currentUser();
  const user = await upsertUserByClerkId(
    userId,
    person?.username ?? null,
    person?.emailAddresses?.[0]?.emailAddress ?? null,
  );
  const rows = (await db().query(`SELECT stripe_customer_id FROM hosted.subscriptions WHERE user_id = $1`, [
    user.id,
  ])) as CustomerRow[];
  const customer = rows[0]?.stripe_customer_id ?? undefined;

  const quantity = plan === "run" ? Math.min(100, Math.max(1, Math.floor(body.quantity ?? 1))) : 1;
  const origin = siteOrigin(req);
  const session = await stripe().checkout.sessions.create({
    mode: plan === "run" ? "payment" : "subscription",
    line_items: [
      plan === "run"
        ? { price, quantity, adjustable_quantity: { enabled: true, minimum: 1, maximum: 100 } }
        : { price, quantity: 1 },
    ],
    client_reference_id: user.id,
    metadata: { user_id: user.id, kind: plan },
    ...(plan === "run" ? {} : { subscription_data: { metadata: { user_id: user.id, kind: plan } } }),
    ...(customer ? { customer } : person?.emailAddresses?.[0]?.emailAddress ? { customer_email: person.emailAddresses[0].emailAddress } : {}),
    success_url: `${origin}/account?checkout=done`,
    cancel_url: `${origin}/pricing`,
    allow_promotion_codes: true,
  });

  if (!session.url) return fail(502, "no_session", "Stripe did not return a checkout URL");
  return json({ url: session.url });
}
