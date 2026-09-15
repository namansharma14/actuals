# site

The Actuals website: a Next.js App Router app.

The landing page has one job, getting `npx actuals` typed, and one argument for it, the real
report. The demo at `/demo` is drawn by `src/render/html.ts`, the renderer the CLI bundles,
imported from the repository root rather than copied. There is no second renderer to keep in
step.

## Run it locally

```
npm install
npm run build && npm run start                     # http://localhost:3000
npm run dev                                        # or the dev server
```

The app reads no environment variables and talks to no service: every page is the landing,
the guide, or the sample report, and all three are built from files in this directory.

## The demo fixture

`fixtures/demo-report.json` is a real run: the founder's own repository, `--redact`, measured
2026-09-04. It is produced through the same check the site applies before it publishes
anything:

```
../node_modules/.bin/tsx scripts/make-fixture.ts ~/.actuals/<repo>/runs/<run>/report.json
```

## What the site may publish

`lib/socket.ts` is the only check. It refuses a report whose `repo_path` is not `(redacted)`,
whose session titles are not `session <8 characters>`, or whose re-read table still has file
paths. It then strips the three fields `--redact` leaves in the file because the renderer
hides them rather than deleting them: the fix target, the fix snippet and the `/insights`
goal line. The published report has no title, path, prompt or line of code in it.

## Routes

| Route | What |
|---|---|
| `/` | the landing page, static |
| `/how-to-use` | the field guide, static |
| `/demo` | the demo report, static, rendered by the CLI's renderer |
| `/demo/report` | the report document itself, for the frames to load |
| `/api/gone` | the retired v1 endpoints answer 410 here |

`next.config.ts` also redirects the v1 addresses (`/index.html`, `/start`, `/onboard`,
`/app`, `/pricing`) to the pages that replaced them.

## Deploying

The project is Hobby, so at most 12 functions per deployment. A deployment from here is
built locally and uploaded:

```
vercel build && vercel deploy --prebuilt      # preview
```
