/**
 * POST /api/stripe/webhook, the only writer of subscription state and the only place a
 * credit is granted.
 *
 * Idempotent on the event id. Unmatched events answer 200 on purpose: a 4xx makes Stripe
 * retry for days and then disable the endpoint.
 */
import type Stripe from "stripe";
import { db, dbConfigured } from "../../../../lib/db";
import { fail, json } from "../../../../lib/http";
import { TIER_OF_PRICE, stripe } from "../../../../lib/stripe";
import { stripeConfigured } from "../../../../lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function firstTime(event: Stripe.Event): Promise<boolean> {
  const rows = (await db().query(
    `INSERT INTO hosted.stripe_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [event.id, event.type],
  )) as Array<{ id: string }>;
  return rows.length > 0;
}

async function userIdFor(session: Stripe.Checkout.Session): Promise<string | null> {
  const fromMetadata = session.metadata?.["user_id"] ?? session.client_reference_id;
  if (fromMetadata) return fromMetadata;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customer) return null;
  const rows = (await db().query(`SELECT user_id FROM hosted.subscriptions WHERE stripe_customer_id = $1`, [
    customer,
  ])) as Array<{ user_id: string }>;
  return rows[0]?.user_id ?? null;
}

async function onCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const userId = await userIdFor(session);
  if (!userId) return;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (customer) {
    await db().query(
      `INSERT INTO hosted.subscriptions (user_id, stripe_customer_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = now()`,
      [userId, customer],
    );
  }
  if (session.mode !== "payment") return;
  const items = await stripe().checkout.sessions.listLineItems(session.id, { limit: 1 });
  const quantity = items.data[0]?.quantity ?? 1;
  await db().query(
    `INSERT INTO hosted.credits (user_id, delta, reason, stripe_session_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (stripe_session_id) DO NOTHING`,
    [userId, quantity, "bought hosted runs", session.id],
  );
}

async function onSubscription(sub: Stripe.Subscription, eventCreated: number): Promise<void> {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const fromMetadata = sub.metadata?.["user_id"];
  const rows = fromMetadata
    ? [{ user_id: fromMetadata }]
    : ((await db().query(`SELECT user_id FROM hosted.subscriptions WHERE stripe_customer_id = $1`, [
        customer,
      ])) as Array<{ user_id: string }>);
  const userId = rows[0]?.user_id;
  if (!userId) return;

  const item = sub.items.data[0];
  const price = item?.price.id ?? "";
  const tier = TIER_OF_PRICE()[price] ?? "free";
  const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status;
  const endsAt = item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null;

  await db().query(
    `INSERT INTO hosted.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, tier, status, current_period_end, event_created, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, now())
       ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id,
                                           stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                                           tier = EXCLUDED.tier,
                                           status = EXCLUDED.status,
                                           current_period_end = EXCLUDED.current_period_end,
                                           event_created = EXCLUDED.event_created,
                                           updated_at = now()
        WHERE hosted.subscriptions.event_created IS NULL
           OR hosted.subscriptions.event_created <= EXCLUDED.event_created`,
    [userId, customer, sub.id, sub.status === "canceled" ? "free" : tier, sub.status === "canceled" ? "canceled" : status, endsAt, new Date(eventCreated * 1000).toISOString()],
  );
}

export async function POST(req: Request): Promise<Response> {
  if (!stripeConfigured() || !dbConfigured()) return fail(503, "not_configured", "billing is not configured on this deployment");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return fail(503, "not_configured", "STRIPE_WEBHOOK_SECRET is not set on this deployment");
  const signature = req.headers.get("stripe-signature");
  if (!signature) return fail(400, "no_signature", "no stripe-signature header");

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    return fail(400, "bad_signature", err instanceof Error ? err.message : "signature check failed");
  }

  if (!(await firstTime(event))) return json({ received: true, duplicate: true });

  switch (event.type) {
    case "checkout.session.completed":
      await onCheckout(event.data.object);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await onSubscription(event.data.object, event.created);
      break;
    default:
      break;
  }
  return json({ received: true });
}
