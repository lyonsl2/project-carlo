# Accounts and payments: setup walkthrough

Project Carlo becomes a subscription product: you sign in, you get a 7-day free
trial without giving a card, and after that you pay to carry on. This document
covers what was built, everything you have to do by hand to switch it on, and
the decisions worth revisiting.

The site is static, with no server to hold a session or a secret key, so the
whole thing is built out of two things a browser can talk to directly: Supabase
for identity and data, and Supabase Edge Functions for the three moments that
need a Stripe secret.

**Nothing here is switched on yet.** With `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` unset, the site builds and deploys exactly as it did
before: public map, no sign-in, no account routes, and no Supabase client in the
bundle. Following this walkthrough is what turns it on.

---

## Contents

1. [How the pieces fit](#how-the-pieces-fit)
2. [The trial, in detail](#the-trial-in-detail)
3. [What is in the repository](#what-is-in-the-repository)
4. [Part 1 — Supabase project](#part-1--supabase-project)
5. [Part 2 — Stripe](#part-2--stripe)
6. [Part 3 — Deploy the edge functions](#part-3--deploy-the-edge-functions)
7. [Part 4 — Turn it on in the web app](#part-4--turn-it-on-in-the-web-app)
8. [Part 5 — Verify end to end](#part-5--verify-end-to-end)
9. [Part 6 — Going live](#part-6--going-live)
10. [Read this before launch: the snapshot is still public](#read-this-before-launch-the-snapshot-is-still-public)
11. [Local development](#local-development)
12. [Running the tests](#running-the-tests)
13. [Decision points and alternatives](#decision-points-and-alternatives)
14. [Deliberately not built](#deliberately-not-built)

---

## How the pieces fit

```
                    ┌─────────────────────────────┐
   browser  ───────►│  Cloudflare Workers (static)│   the existing site
                    └─────────────────────────────┘
       │
       ├── auth + data ──►  Supabase  ──►  Postgres (RLS is the boundary)
       │                       ▲
       └── billing ───────►  Edge Functions  ──►  Stripe
                                 ▲
                                 └──── webhook ──── Stripe
```

Three rules follow from the site being static, and the rest of the design is
downstream of them.

**Row Level Security is the security boundary, not the UI.** The browser holds a
publishable key and talks to Postgres through PostgREST. A check that only
exists in React can be skipped by anyone willing to open a terminal, so every
per-user table has RLS on and writes are gated on entitlement in the policy
itself.

**Secrets live only in edge functions.** The Stripe secret key and the Supabase
service role key never reach the browser. The three functions are the only code
that holds them.

**Stripe is the source of truth, including for the trial.** Postgres holds a
projection of the subscription, written only by the webhook. Nothing in the app
writes billing state, and if the two disagree, Stripe wins.

---

## The trial, in detail

A new account is offered a 7-day trial with no card. That is a Stripe
subscription, not a local timer:

1. The visitor signs in and lands on `/account`, which offers the trial.
2. `stripe-checkout` creates a Checkout session with
   `payment_method_collection: "if_required"` and
   `subscription_data.trial_period_days: 7`. Nothing is due today, so Stripe
   does not ask for a card.
3. The subscription is created in `trialing`, the webhook mirrors it, and
   `has_access()` starts returning true.
4. If the trial reaches its end with no payment method,
   `trial_settings.end_behavior.missing_payment_method: "pause"` moves the
   subscription to `paused`. That status does not grant access, so the site
   locks. The account and its saved parishes stay exactly as they were.
5. To come back, the visitor adds a card. `stripe-checkout` notices the paused
   subscription and returns a **setup-mode** session instead of a new
   subscription. The webhook makes the card the customer's default and calls
   `subscriptions.resume`, so the same subscription picks up where it left off.

The states, and what each one means here:

| Stripe status | Access? | What the account page says |
|---|---|---|
| _(no subscription)_ | no | Start your free 7-day trial |
| `trialing` | **yes** | *n* days left in your free trial |
| `paused` | no | Your free trial has ended — add a payment method |
| `active` | **yes** | You're subscribed |
| `past_due`, having paid before | **yes** | We couldn't take your last payment |
| `past_due`, never paid | no | That card was declined |
| `canceled`, `unpaid`, `incomplete` | no | Your subscription has ended |

That split of `past_due` matters and is easy to miss. Resuming a paused
subscription makes Stripe raise an invoice and attempt it immediately; if the
card declines, the subscription lands in `past_due`. Treating `past_due` as
entitled — which is the right thing to do for a long-standing subscriber whose
card expired — would otherwise mean a declined card buys full access. So the
grace period is limited to subscriptions that have paid at least once, recorded
in `subscriptions.first_paid_at` by a trigger.

---

## What is in the repository

| Path | What it is |
|---|---|
| `supabase/migrations/*.sql` | Tables, RLS policies, `has_access()` |
| `supabase/functions/stripe-checkout/` | Starts the trial, sells a subscription, or collects a card for a paused one |
| `supabase/functions/stripe-portal/` | Creates a Billing Portal session |
| `supabase/functions/stripe-webhook/` | Mirrors Stripe state; resumes paused subscriptions |
| `supabase/functions/_shared/` | CORS, env, redirect safety, plan mapping, checkout decision, Stripe mapping |
| `supabase/tests/rls_test.sql` | pgTAP suite for the policies |
| `supabase/config.toml` | Local stack config, and `verify_jwt = false` for the webhook |
| `apps/web/src/auth/` | Session provider, sign-in actions, `RequireAccess` gate |
| `apps/web/src/api/account.ts` | Every per-user read and write |
| `apps/web/src/views/{SignIn,AuthCallback,Account}Page.tsx` | The account UI |
| `scripts/db-test-local.sh` | Runs the pgTAP suite without Docker |

### The data model

| Table | Written by | Readable by |
|---|---|---|
| `profiles` | trigger on `auth.users` | its owner (only `display_name` is writable) |
| `saved_churches` | its owner, and only while entitled | its owner |
| `stripe_customers` | edge functions (service role) | its owner |
| `subscriptions` | webhook (service role) | its owner |
| `stripe_events` | webhook (service role) | nobody |

### Which routes are public

| Route | Public? |
|---|---|
| `/landing` | yes — the marketing page and the only way in |
| `/signin`, `/auth/callback` | yes |
| `/account` | signed in, but **not** gated on payment; it is where you go to pay |
| `/about` | yes (already behind its own feature flag) |
| `/`, `/churches/:slug` | require a live trial or subscription |

---

## Part 1 — Supabase project

### 1.1 Create the project

Create one at [database.new](https://database.new). Choose a region near your
users. Note the project ref from the URL — everything below calls it
`YOUR-PROJECT-REF`.

### 1.2 Link the CLI

```bash
npm install -g supabase       # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
```

`supabase link` asks for the database password you set when creating the
project. If you have lost it, reset it under **Project Settings → Database**.

### 1.3 Apply the migrations

```bash
supabase db push
```

This runs the three files in `supabase/migrations` in order. Afterwards, check
that the dashboard shows no RLS warnings: **Database → Tables** flags any table
exposed without row level security, and there should be none.

### 1.4 Configure the auth URLs

**Authentication → URL Configuration**:

- **Site URL**: `https://projectcarlo.com`
- **Redirect URLs** — every origin that will complete a sign-in:
  - `https://projectcarlo.com/auth/callback`
  - `http://127.0.0.1:5173/auth/callback` and `http://localhost:5173/auth/callback`
  - any Cloudflare preview domain you want sign-in to work on

A redirect that is not on this list is silently rewritten to the Site URL, which
presents as "the magic link takes me to the home page and I am not signed in".
That is the first thing to check if sign-in misbehaves.

### 1.5 Set up email delivery — do not skip this

Supabase's built-in email sender is for development. It is rate limited to a
handful of messages an hour and its deliverability is not guaranteed. Magic
links **are** the way in, and with the whole site behind them an undelivered
email is a customer who cannot reach the product they are paying for.

Configure your own SMTP under **Project Settings → Authentication → SMTP
Settings** before letting real people sign in. Resend, Postmark, and Amazon SES
all work; Postmark has the strongest reputation for transactional mail, Resend
is the quickest to set up.

While you are there, edit the **Magic Link** template under **Authentication →
Email Templates**. The default is generic and reads like phishing.

### 1.6 Optional: Google sign-in

1. In Google Cloud, create an OAuth 2.0 client (Web application).
2. Authorised redirect URI:
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
3. In Supabase, **Authentication → Providers → Google**: enable, paste the
   client ID and secret.
4. Set `VITE_AUTH_GOOGLE_ENABLED=true` in the web build.

The button stays hidden until step 4, so that is what makes it appear.

---

## Part 2 — Stripe

Do all of this in **test mode** first. The toggle is top right in the dashboard.

### 2.1 Create the product and prices

**Product catalogue → Add product**:

- Name: `Project Carlo` — this appears on the receipt and the card statement, so
  make it recognisable.
- Add two **recurring** prices: `$3.00` / month and `$30.00` / year.

Copy both price IDs (`price_...`); they are needed in 2.4.

If you change these amounts, update the display copy in
`apps/web/src/lib/plans.ts` to match. The client only sends a plan key, so a
mismatch shows the wrong number in the UI but cannot charge the wrong amount.

### 2.2 Configure the Billing Portal

**Settings → Billing → Customer portal**. The portal will not open until it has
been configured and saved at least once, and the error is unhelpful.

Enable at minimum:

- Update payment method
- Cancel subscription — choose *at end of billing period*; cancelling
  immediately raises refund questions you have not built answers for
- Invoice history

### 2.3 Create the webhook endpoint

**Developers → Webhooks → Add endpoint**:

- URL: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/stripe-webhook`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

Copy the signing secret (`whsec_...`).

`customer.subscription.paused` and `.resumed` are not needed: Stripe emits an
`.updated` carrying the same object, and subscribing to both would mean two
paths writing the same row. Invoice events are left out for the same reason.

### 2.4 Set the function secrets

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SIGNING_SECRET=whsec_... \
  STRIPE_PRICE_MONTHLY=price_... \
  STRIPE_PRICE_ANNUAL=price_... \
  SITE_URL=https://projectcarlo.com \
  ALLOWED_ORIGINS=https://projectcarlo.com
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected into deployed functions automatically. Do not set them yourself.

`ALLOWED_ORIGINS` is a comma-separated list. Only origins on it get CORS headers
back, so add any preview domain you want to be able to check out from.

---

## Part 3 — Deploy the edge functions

```bash
supabase functions deploy
supabase functions list
```

`stripe-webhook` should show JWT verification **off** (Stripe cannot present a
Supabase token; its signature is what authenticates the request), and the other
two **on**.

Send a test event from **Developers → Webhooks → your endpoint → Send test
webhook**, then:

```bash
supabase functions logs stripe-webhook
```

A test event logs `No Supabase user for Stripe customer ...` and returns 200.
That is correct — the synthetic customer in a test event belongs to nobody.

---

## Part 4 — Turn it on in the web app

Two variables switch the feature on. They are inlined at build time, so they
must be present wherever `pnpm build:web` runs, not at runtime.

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable / anon key>
```

Both are public by design; RLS is what protects the data behind them.

Setting those two also turns the paywall on. To run accounts alongside a public
map instead — sign-in and saved parishes, but no gate — add
`VITE_REQUIRE_ACCOUNT=false`.

**Locally**: put them in `apps/web/.env.development.local`, which is gitignored.
See `apps/web/.env.example`.

**In CI**: `.github/workflows/deploy-web.yml` runs the build. Add both as
repository secrets and pass them into the build step:

```yaml
      - name: Build
        run: pnpm build:web
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
```

### What this does to SEO

Turning the paywall on changes what the build produces, deliberately:

- **Parish pages are no longer prerendered.** Those 132 static HTML files are
  the full schedules — the paid content — readable by anyone with the URL. With
  a paywall they would be the largest hole in it, so `scripts/prerender.ts`
  stops writing them.
- **The sitemap lists only `/landing`,** and `robots.txt` disallows everything
  else. Advertising URLs that all redirect to a sign-in earns nothing and reads
  to a crawler as a soft 404.

This is a real cost. The prerendered pages, the JSON-LD, and the sitemap were
the site's organic acquisition, and a paywalled site gives that up almost
entirely. If search traffic matters more than the subscription, the middle
ground is to keep parish pages public and gate only the map and saved parishes
(`VITE_REQUIRE_ACCOUNT=false` plus a gate on the routes you choose). Serving
full content to crawlers and a paywall to everyone else is **cloaking** and will
earn a manual penalty; Google's supported route for that is
[structured data for paywalled content](https://developers.google.com/search/docs/appearance/structured-data/paywalled-content),
which needs the page to be marked up honestly.

---

## Part 5 — Verify end to end

With the site deployed and the variables set:

1. **Visit the site signed out.** You should land on `/landing` with a
   "Start your free 7-day trial" button and no search box.
2. **Sign in.** Enter your address, open the emailed link. You land on
   `/account`, which offers the trial.
3. **Check the profile row.** `public.profiles` should have gained a row with
   your email. If not, the `auth.users` trigger did not fire — re-run
   `supabase db push`.
4. **Start the trial.** Stripe should *not* ask for a card. You come back to
   `/account`, see *Confirming with Stripe…* briefly, then *7 days left in your
   free trial*.
5. **Use the site.** The map loads; open a parish and save it.
6. **End the trial early.** In the Stripe dashboard, open the subscription and
   use **Actions → End trial**, having removed any payment method. Stripe moves
   it to `paused`. Reload the site: you should be bounced to `/account` with
   *Your free trial has ended*, and your saved parishes should still be listed.
7. **Add a card.** Click *Add a payment method*, use `4242 4242 4242 4242`. The
   subscription resumes and the site unlocks.
8. **Open the billing portal**, cancel, come back. The account page should say
   *Your subscription is ending* with the end date.

Useful test cards: `4000 0000 0000 9995` declines for insufficient funds — worth
trying at step 7, because the subscription should stay locked rather than
falling into an entitled `past_due`. `4000 0025 0000 3155` requires 3D Secure.

If step 4 stalls on *Confirming with Stripe*, the webhook is the problem. Check
**Developers → Webhooks → your endpoint** for delivery failures, then
`supabase functions logs stripe-webhook`.

---

## Part 6 — Going live

- [ ] Switch Stripe out of test mode and redo 2.1–2.3 with live keys. Test-mode
      and live-mode objects are entirely separate: prices, webhook endpoints and
      signing secrets all have to be created again.
- [ ] `supabase secrets set` the live `sk_live_...` and the live `whsec_...`.
- [ ] Confirm your own SMTP is configured (1.5). This is the one that bites.
- [ ] Complete Stripe's business profile so payouts are not held.
- [ ] Decide about tax. Stripe Tax is not enabled; if you need it, add
      `automatic_tax: { enabled: true }` in
      `supabase/functions/stripe-checkout/index.ts` and register your tax
      obligations in Stripe first.
- [ ] Publish terms and a refund policy, and link them. Stripe's dispute process
      asks for them, and you are now taking recurring money from strangers.
- [ ] Set up alerting on failed webhook deliveries. Stripe emails after repeated
      failures, but the default is easy to miss.
- [ ] Re-read the next section.

---

## Read this before launch: the snapshot is still public

The gate described above is a routing gate in a single-page app. It decides what
React renders. It does not protect the data, because the data is not behind it.

`apps/web/public/frontend.snapshot` is a gzipped SQLite database of every parish
and every service time, served as a static file from the CDN. Anyone can fetch
it directly, with no account, and read the entire product:

```
curl -s https://projectcarlo.com/frontend.snapshot | gunzip > carlo.db
```

Turning the paywall on closed the prerendered HTML hole. It did not close this
one, and no amount of client-side work can: the file has to be readable by the
browser, and a browser with a paywalled page in it is still just a browser.

Whether that matters is a business question, not a technical one. If what people
pay for is the map, the search, and the saved parishes, this is tolerable — plenty
of subscription products have a scrapeable back end. If the compiled schedule
data is itself the asset, close it before launch. In rough order of effort:

1. **Serve the snapshot from private Supabase Storage.** Upload it from the
   weekly pipeline into a private bucket with a policy requiring
   `has_access()`, and have `src/db.ts` download it through the Supabase client
   instead of `fetch("/frontend.snapshot")`. Simple and genuinely closed. Costs
   Supabase egress on every cold load and gives up the Cloudflare CDN, which is
   currently what makes the map feel instant.
2. **Hand out a short-lived signed URL** from a fourth edge function that checks
   entitlement. Keeps the file on object storage, adds one round trip, and
   the URL is shareable for as long as it lives.
3. **Verify a token at the edge.** The site already deploys as a Cloudflare
   Worker; give it a request handler that checks a Supabase JWT on
   `/frontend.snapshot` before serving it. Keeps the CDN, but entitlement is not
   in the JWT by default, so you would add it with a
   [custom access token hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
   and accept that the claim is up to an hour stale.

My recommendation: ship with option 1 if the data is the product, and otherwise
write down explicitly that the snapshot is public so nobody later assumes it is
not.

---

## Local development

Needs Docker.

```bash
supabase start                                   # Postgres, Auth, PostgREST, Edge Runtime
supabase db reset                                # apply migrations to the local database
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve --env-file supabase/functions/.env
```

`supabase start` prints the local API URL and anon key. Put them in
`apps/web/.env.development.local` and run `pnpm dev:web`.

Magic-link emails are caught locally rather than sent — the CLI prints the URL
of the local mail viewer.

For webhooks, forward Stripe to the local function:

```bash
stripe listen --forward-to \
  http://127.0.0.1:54321/functions/v1/stripe-webhook
```

`stripe listen` prints its **own** signing secret, which is not the one from the
dashboard endpoint. Put that one in `supabase/functions/.env` while developing.

---

## Running the tests

```bash
supabase test db                       # pgTAP: the RLS policies (needs Docker)
./scripts/db-test-local.sh             # the same suite against a plain PostgreSQL
cd supabase/functions && deno test --allow-env
pnpm --filter web test                 # vitest
pnpm lint:web && pnpm check:web
```

`scripts/db-test-local.sh` exists because the pgTAP suite is the most valuable
test here and it should not need Docker to run. It applies
`scripts/plain-postgres-shim.sql` first, which recreates the parts of a Supabase
database the migrations depend on: the `anon` / `authenticated` / `service_role`
roles, the `auth` schema, `auth.uid()`, and Supabase's default grants on
`public`. It needs `postgresql-<version>-pgtap` installed.

---

## Decision points and alternatives

These are the choices worth revisiting. Each says what was picked, why, and what
would make you choose otherwise.

### Stripe owns the trial, rather than a `trial_ends_at` column

The first cut tracked the trial in Postgres, which is less machinery: no Stripe
object until someone pays, nothing to reconcile, and "no credit card required"
is true by construction. Stripe owning it wins on the things that bite later —
one system decides who may use the product, the trial cannot be extended by
editing a row, and trial-to-paid conversion shows up in Stripe's own reporting
rather than having to be derived.

The costs are real and worth knowing:

- Every trial creates a Stripe customer and subscription, including the ones
  that never convert. That is noise in the dashboard and in any per-object
  pricing.
- The trial does not start at sign-in; it starts after a round trip through
  Checkout. A brand new user therefore sees `/account` before they see the map.
  Going back to a local `trial_ends_at` is the fix if that first-run friction
  turns out to cost more than the tidiness is worth.

### `pause`, rather than `cancel`, when the trial ends without a card

`trial_settings.end_behavior.missing_payment_method` also accepts `cancel`,
which is markedly simpler: the subscription ends, and coming back is an ordinary
Checkout with a card. No setup-mode session, no resume, no `first_paid_at`
subtlety.

`pause` was chosen because the same subscription survives, so a returning
customer keeps one continuous billing history. If the recovery path ever gives
trouble, switching to `cancel` is a one-word change in
`stripe-checkout/index.ts` plus deleting the `collectCard` branch.

### `past_due` grants access only after a first successful payment

Explained in [The trial, in detail](#the-trial-in-detail). The alternative is to
refuse `past_due` outright, which is safe but cuts off long-standing subscribers
on the first failed retry, and they are usually just an expired card. The
`first_paid_at` stamp is what lets both be true at once. It is set by a trigger
rather than by the webhook so the invariant holds no matter what writes the row.

### Supabase, rather than Cloudflare D1 or a small server

The site already deploys to Cloudflare, so D1 plus Workers was the obvious
alternative and would keep everything on one platform. Supabase wins because
**auth is the expensive part to build**, not the database: magic links, token
refresh, email change confirmation, and OAuth are weeks of work and a permanent
security liability if you get them wrong. RLS also lets the browser talk to the
database directly without an API layer in between.

Reconsider if you end up wanting significant server-side logic. At that point
you are running two platforms for one product.

### Edge Functions, rather than Cloudflare Workers, for the Stripe hooks

The functions sit next to the database they write to and the auth that issues
the tokens they verify, and they deploy on their own cadence rather than with
every site change. The cost is a second deploy target and a second runtime.

They port to Cloudflare Workers with little change — same Web APIs, same Stripe
SDK, same async signature verification — but you would then hold the service
role key in Cloudflare and lose `verify_jwt` as a free front door. Note that if
you close the snapshot hole with option 3 above, you are running a Worker
anyway, at which point consolidating starts to look better.

### Magic links, rather than passwords

No password to store, leak, reset, or check against a breach list, and no
support burden. The cost is that sign-in depends on email delivery, it is
slower, and it is awkward when someone opens the link on a different device from
the one that asked for it. With the whole site gated, that cost lands on paying
customers, so **configure your own SMTP** (1.5) and consider adding passwords if
support requests pile up. Supabase supports them out of the box; the sign-in
page is the only thing that would change.

### Writes are gated on entitlement in the policy, not the client

`saved_churches`' insert policy calls `has_access()`. Doing it in React would be
simpler and would give a nicer error, but it would be bypassable with `curl`.
Reads are deliberately left open to the owner, so someone whose trial lapsed can
still see what they saved.

One wrinkle: PostgREST reports a policy refusal as `42501` with no detail, so the
client infers "your access has lapsed" from the fact that this is the only policy
that can refuse an authenticated user's own insert. If you add another
restriction to that policy, `AccessRequiredError` becomes a lie — switch to a
`BEFORE INSERT` trigger raising a distinguishable `SQLSTATE` at that point.

### `status` is `text`, not an enum

An enum or a `CHECK` would be better data hygiene. Both would also mean that the
day Stripe introduces a status, the webhook starts failing — and a failing
webhook means Stripe retries forever while a customer who has paid sits locked
out. Correctness of the money flow beats tidiness of the column. The statuses
that grant access live in one place, `has_access()`.

### Cancelled subscriptions are kept, not deleted

`customer.subscription.deleted` upserts the row with `status = 'canceled'`
rather than removing it, so the account page can say what happened and when. The
cost is one row per subscription ever held, which is why
`pickPrimarySubscription()` exists on the client.

### The webhook claims event ids before doing work

Stripe delivers at least once. `stripe_events` is an idempotency ledger: the
handler inserts the event id, and a unique violation means "already processed,
skip". On failure it deletes the claim so the retry is not mistaken for a
duplicate.

An upsert-only design without the ledger would also be idempotent for
subscription rows specifically, and is simpler. The ledger earns its place now
that the handler does things that are not upserts — attaching a payment method
and resuming a subscription — and it gives you a log of what was processed.

### The account page polls after checkout

Stripe redirects the browser back the instant Checkout completes, which is
usually before the webhook has been delivered. Telling someone who has just
started a trial that they need to start a trial is the worst possible moment to
be wrong, so the page polls entitlements for up to 30 seconds and then explains
itself.

Two alternatives, both better in some way:

- **Verify the session server-side.** Pass `session_id={CHECKOUT_SESSION_ID}`
  through the success URL and add a function that retrieves the session from
  Stripe. Authoritative and instant, at the cost of another endpoint.
- **Supabase Realtime.** Subscribe to inserts on `subscriptions` and let the
  webhook's write push to the browser. Elegant; means enabling the realtime
  service and holding a websocket open on a page most people visit rarely.

### The client sends a plan key, never a price id

`stripe-checkout` maps `"monthly"` / `"annual"` onto `STRIPE_PRICE_MONTHLY` /
`STRIPE_PRICE_ANNUAL`. Accepting a price id from the browser — even validated
against an allow-list — would mean the set of purchasable things is defined in
two places. The cost is that adding a plan is a code change plus a secret.

### Database types are hand-written

`apps/web/src/lib/database.types.ts` is written by hand so the repository
type-checks without a linked Supabase project. Once you have one, regenerate
instead of editing:

```bash
supabase gen types typescript --linked > apps/web/src/lib/database.types.ts
```

### `saved_churches` stores a slug with no foreign key

Parish records live in the SQLite snapshot, not in Postgres, so there is nothing
for a foreign key to point at. A format `CHECK` is the only integrity available,
and the account page tolerates a slug that no longer resolves.

The alternative is to have the weekly pipeline mirror `church` into Postgres:
a real foreign key, joins between saved parishes and parish data, and the door
open to server-side features like change notifications. It also means two copies
of the pipeline's output that can drift. Worth doing when you build something
that needs to know about parishes server-side — and note that it would also give
you a way to serve parish data through RLS instead of as a public file.

### CORS echoes an allow-list, rather than `*`

`ALLOWED_ORIGINS` gates which origins get CORS headers back. These endpoints are
authenticated and create billing sessions, so a wildcard would let any page on
the internet drive them with a token it had somehow obtained. The cost is one
more thing to remember when a new preview domain appears.

### API keys

The code reads `VITE_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which
is what Supabase injects into edge functions today. Supabase is migrating to
publishable (`sb_publishable_...`) and secret (`sb_secret_...`) keys. The new
publishable key drops straight into `VITE_SUPABASE_ANON_KEY` with no code
change. If you move the functions to secret keys, update `createServiceClient()`
in `supabase/functions/_shared/supabase.ts` — the only place the service key is
read.

---

## Deliberately not built

Each of these is a real gap, listed so it is a decision rather than an oversight.

- **Account deletion.** Users cannot delete their own account. `auth.users`
  cascades to every table here, so the work is an edge function that calls
  `auth.admin.deleteUser` after cancelling any Stripe subscription. Needed
  before you have EU users in any number, and more pressing now that everyone
  who uses the site has an account.
- **Trial abuse.** Nothing stops someone signing up again with a second email
  address for a second trial. A card requirement is the usual answer and defeats
  the point; most products in this shape simply accept it. Watch the numbers
  before spending anything on it.
- **Email change.** Supabase supports it and `config.toml` already requires
  confirmation from both addresses. There is no UI for it.
- **Refund and dispute handling.** `charge.dispute.created` is not handled. At
  this volume, dealing with them by hand in the Stripe dashboard is fine.
- **Dunning email of our own.** Stripe's automatic emails are the only thing
  telling a customer their card failed. Check they are enabled under
  **Settings → Billing → Subscriptions and emails**.
- **Rate limiting on sign-in.** Supabase applies per-project defaults; they are
  adjustable under **Authentication → Rate Limits** and worth a look before
  launch.
