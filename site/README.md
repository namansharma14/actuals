# site

The Actuals website and the first slice of the hosted layer: a Next.js App Router app.

The landing page has one job, getting `npx actuals` typed, and one argument for it, the real
report. Both the demo at `/demo` and every share page at `/r/<id>` are drawn by
`src/render/html.ts`, the renderer the CLI bundles, imported from the repository root rather
than copied. There is no second renderer to keep in step.

## Run it locally

```
npm install
vercel env pull .env.local --environment=preview   # or copy .env.example
npm run build && npm run start                     # http://localhost:3000
npm run dev                                        # or the dev server
```

`npm run build` passes with no keys at all. Each surface checks its own keys and says
"not configured on this deployment" rather than failing.

## Environment

| Variable | Used by | Without it |
|---|---|---|
| `DATABASE_URL` | accounts, runs, credits, subscriptions (Neon) | `/account`, uploads and share pages answer 503 |
| `BLOB_READ_WRITE_TOKEN` | the two files a hosted run stores | uploads answer 503 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | GitHub sign-in | `/account` and `/sign-in` say sign-in is not configured |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | checkout and the webhook | checkout and the webhook answer 503 |
| `STRIPE_PRICE_GO`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_MAX`, `STRIPE_PRICE_RUN` | one per tier, `price_...` | that tier's button reads "checkout not configured on this deployment" and is disabled |
| `SITE_ORIGIN` | the origin in a share link | falls back to `VERCEL_URL`, then the request |

## The database

`db/schema.sql` holds four tables and an event log, all in the `hosted` schema. The v1
portal owns `public` on the same Neon database and is still serving getactuals.net, so
nothing here shares a table name with it.

```
node --env-file=.env.local scripts/migrate.mjs     # npm run db:migrate
```

Every statement is idempotent, and Neon's HTTP driver runs one per round trip, so the file
holds plain statements only.

## The demo fixture

`fixtures/demo-report.json` is a real run: the founder's own repository, `--redact`, measured
2026-09-04. It is produced through the same check every upload goes through:

```
../node_modules/.bin/tsx scripts/make-fixture.ts ~/.actuals/<repo>/runs/<run>/report.json
```

## What a hosted run may carry

`lib/socket.ts` is the only gate. It refuses a report whose `repo_path` is not `(redacted)`,
whose session titles are not `session <8 characters>`, or whose re-read table still has file
paths. It then strips the three fields `--redact` leaves in the socket because the renderer
hides them rather than deleting them: the fix target, the fix snippet and the `/insights`
goal line. A stored report has no title, path, prompt or line of code in it.

## Routes

| Route | What |
|---|---|
| `/` | the landing page, static |
| `/demo` | the demo report, static, rendered by the CLI's renderer |
| `/pricing` | the tiers, reads the price ids at request time |
| `/account` | plan and allowance, connected computers, hosted pages; never a key |
| `/pair` | approve the code `actuals login` printed; one button connects that computer |
| `/sso-callback` | where GitHub returns a person, on the way back to where they were headed |
| `/sign-in` | Clerk, GitHub |
| `/r/<id>` | a share page |
| `/r/<id>/sticker.png` | that run's sticker, streamed from the private store |
| `POST /api/runs` | the upload the CLI makes, bearer licence key |
| `GET /api/runs/<id>` | the socket behind a share page |
| `POST /api/checkout` | a Stripe Checkout session |
| `POST /api/stripe/webhook` | the only writer of subscription state |

## Deploying

The project is Hobby, so at most 12 functions per deployment; this app builds nine. The
Vercel project `actuals` still holds the v1 site, whose build settings are not Next.js, so
a deployment from here is built locally and uploaded:

```
vercel build && vercel deploy --prebuilt      # preview
```

Never `--prod` from here while v1 is live on getactuals.net.
