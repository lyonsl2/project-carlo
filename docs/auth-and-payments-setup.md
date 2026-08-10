# Accounts and payments: setup walkthrough

Project Carlo is a static site. There is no server to put a session on and no
place to keep a Stripe secret key, so accounts and payments are built out of two
things the browser can talk to directly: Supabase for identity and data, and
Supabase Edge Functions for the three moments that need a secret.

Nothing in this document is wired up yet. The code is in the repository and the
site builds and deploys without any of it — with `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` unset, the account routes are never registered, no
sign-in link appears, and the Supabase client is not even included in the
bundle. Following this walkthrough is what turns it on.

---

## Contents

1. [How the pieces fit](#how-the-pieces-fit)
2. [What is in the repository](#what-is-in-the-repository)
3. [Part 1 — Supabase project](#part-1--supabase-project)
4. [Part 2 — Stripe](#part-2--stripe)
5. [Part 3 — Deploy the edge functions](#part-3--deploy-the-edge-functions)
6. [Part 4 — Turn it on in the web app](#part-4--turn-it-on-in-the-web-app)
7. [Part 5 — Verify end to end](#part-5--verify-end-to-end)
8. [Part 6 — Going live](#part-6--going-live)
9. [Local development](#local-development)
10. [Running the tests](#running-the-tests)
11. [Decision points and alternatives](#decision-points-and-alternatives)
12. [Deliberately not built](#deliberately-not-built)

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

Three rules follow from the site being static, and everything else in the design
is downstream of them:

**Row Level Security is the security boundary, not the UI.** The browser holds a
publishable key and talks to Postgres through PostgREST. Any check that only
exists in React can be skipped by anyone willing to open a terminal, so every
per-user table has RLS on, and the free-tier cap on saved parishes is enforced
by an insert policy rather than by the save button.

**Secrets live only in edge functions.** The Stripe secret key and the Supabase
service role key never reach the browser. The three functions are the only code
that holds them.

**Stripe is the source of truth for money.** Postgres holds a projection of the
subscription, written only by the webhook. Nothing in the app writes billing
state, and if the two ever disagree, Stripe wins.

---

## What is in the repository

| Path | What it is |
|---|---|
| `supabase/migrations/*.sql` | Tables, RLS policies, and the entitlement functions |
| `supabase/functions/stripe-checkout/` | Creates a Checkout session for the signed-in user |
| `supabase/functions/stripe-portal/` | Creates a Billing Portal session |
| `supabase/functions/stripe-webhook/` | Mirrors Stripe subscription state into Postgres |
| `supabase/functions/_shared/` | CORS, env, redirect safety, plan mapping, Stripe mapping |
| `supabase/tests/rls_test.sql` | pgTAP suite for the policies |
| `supabase/config.toml` | Local stack config, and `verify_jwt = false` for the webhook |
| `apps/web/src/auth/` | Session provider, route guard, sign-in actions |
| `apps/web/src/api/account.ts` | Every per-user read and write |
| `apps/web/src/views/{SignIn,AuthCallback,Account}Page.tsx` | The account UI |
| `scripts/db-test-local.sh` | Runs the pgTAP suite without Docker |

### The data model

| Table | Written by | Readable by |
|---|---|---|
| `profiles` | trigger on `auth.users` | its owner (only `display_name` is writable) |
| `saved_churches` | its owner, within their plan | its owner |
| `stripe_customers` | edge functions (service role) | its owner |
| `subscriptions` | webhook (service role) | its owner |
| `stripe_events` | webhook (service role) | nobody |

### What the paid tier buys

A free account can save **3 parishes**. A patron can save any number. The number
lives in `public.free_saved_church_limit()` and is read by both the insert policy
and the account page, so changing it is a one-line migration.

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

This runs the three files in `supabase/migrations` in order. Confirm afterwards
that the Supabase dashboard shows no RLS warnings: **Database → Tables** flags
any table that is exposed without row level security, and there should be none.

### 1.4 Configure the auth URLs

**Authentication → URL Configuration**:

- **Site URL**: `https://projectcarlo.com`
- **Redirect URLs** — add every origin that will complete a sign-in:
  - `https://projectcarlo.com/auth/callback`
  - `https://*.project-carlo.workers.dev/auth/callback` (Cloudflare preview
    deployments, if you want sign-in to work on them)
  - `http://127.0.0.1:5173/auth/callback` and `http://localhost:5173/auth/callback`

A redirect that is not on this list is silently rewritten to the Site URL, which
looks like "the magic link takes me to the home page and I am not signed in".
That is the first thing to check if sign-in misbehaves.

### 1.5 Set up email delivery — do not skip this

Supabase's built-in email sender is for development. It is rate limited to a
handful of messages per hour and its deliverability is not guaranteed. Magic
links **are** the sign-in mechanism here, so an undelivered email is a locked-out
user.

Configure your own SMTP under **Project Settings → Authentication → SMTP
Settings** before letting real people sign in. Resend, Postmark, and Amazon SES
all work; Postmark has the best reputation for transactional mail, Resend is the
quickest to set up.

While you are there, edit the **Magic Link** template under **Authentication →
Email Templates**. The default is generic and reads like phishing.

### 1.6 Optional: Google sign-in

Only worth doing if you expect signup friction from magic links.

1. In Google Cloud, create an OAuth 2.0 client (Web application).
2. Authorised redirect URI:
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
3. In Supabase, **Authentication → Providers → Google**: enable, paste the
   client ID and secret.
4. Set `VITE_AUTH_GOOGLE_ENABLED=true` in the web build.

The button stays hidden until that variable is set, so step 4 is what makes it
appear.

---

## Part 2 — Stripe

Do all of this in **test mode** first. The toggle is in the top right of the
Stripe dashboard.

### 2.1 Create the product and prices

**Product catalogue → Add product**:

- Name: `Project Carlo Patron` (this is what appears on the card statement
  descriptor and the receipt, so make it recognisable)
- Add two **recurring** prices:
  - `$3.00` / month
  - `$30.00` / year

Copy both price IDs (`price_...`). They are needed in 2.4.

If you change these amounts, update the display copy in
`apps/web/src/lib/plans.ts` to match. The client only ever sends a plan key, so
a mismatch shows the wrong number in the UI but cannot charge the wrong amount.

### 2.2 Configure the Billing Portal

**Settings → Billing → Customer portal**. The portal will not open until it has
been configured and saved at least once, and the error is unhelpful.

Enable at minimum:

- Update payment method
- Cancel subscription (choose *at end of billing period* — cancelling
  immediately means refund questions you have not built answers for)
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

Invoice events are deliberately not handled. Everything they would tell you — a
renewal, a failed charge, a recovery — also arrives as
`customer.subscription.updated`, and subscribing to both means two code paths
writing the same row.

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
```

The webhook is deployed without JWT verification (`verify_jwt = false` in
`supabase/config.toml`) because Stripe cannot present a Supabase token. Its
signature check is what authenticates the request. Verify after deploying:

```bash
supabase functions list
```

`stripe-webhook` should show JWT verification off, the other two on.

Then send a test event from **Developers → Webhooks → your endpoint → Send test
webhook**, and check the logs:

```bash
supabase functions logs stripe-webhook
```

A `checkout.session.completed` test event will log
`No Supabase user for Stripe customer ...` and return 200. That is correct — the
synthetic customer in a test event does not belong to anyone.

---

## Part 4 — Turn it on in the web app

Two variables switch the feature on. They are inlined at build time, so they
must be present wherever `pnpm build:web` runs, not at runtime.

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable / anon key>
```

Both are public by design; RLS is what protects the data behind them.

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

Committing them to `apps/web/.env.production` alongside the existing Geoapify
key would also work and is consistent with what the repository already does.
That is a judgement call about how much you mind the project ref being in git
history — it is discoverable from the deployed bundle either way.

---

## Part 5 — Verify end to end

With the site deployed and the variables set:

1. **Sign in.** Click *Sign in*, enter your address, open the link. You should
   land on `/account`.
2. **Check the profile row.** In the Supabase dashboard, `public.profiles`
   should have gained a row with your email. If not, the `auth.users` trigger
   did not fire — re-run `supabase db push`.
3. **Save four parishes.** The fourth should be refused with an upgrade prompt.
   The refusal comes from the database, so it also happens if you call the API
   directly.
4. **Subscribe.** Use Stripe's test card `4242 4242 4242 4242`, any future
   expiry, any CVC. You should come back to `/account`, see *confirming with
   Stripe…* briefly, then *You're a patron*.
5. **Save a fifth parish.** It should now work.
6. **Open the billing portal**, cancel, and come back. The account page should
   say *Your patronage is ending* with the end date.

Useful test cards: `4000 0000 0000 9995` declines for insufficient funds;
`4000 0025 0000 3155` requires 3D Secure authentication.

If step 4 stalls on *confirming with Stripe*, the webhook is the problem. Check
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
- [ ] Decide about tax. Stripe Tax is not enabled in the checkout call; if you
      need it, add `automatic_tax: { enabled: true }` in
      `supabase/functions/stripe-checkout/index.ts` and register your tax
      obligations in Stripe first. For a small donation-style subscription in a
      single country you may not need it — take advice.
- [ ] Write a refund policy and put it somewhere linkable. Stripe's dispute
      process asks for one.
- [ ] Set up alerting on failed webhook deliveries. Stripe emails you after
      repeated failures, but the default is easy to miss.

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

### Supabase, rather than Cloudflare D1 or a small server

The site already deploys to Cloudflare, so D1 plus Workers was the obvious
alternative and would have kept everything on one platform. Supabase wins here
because **auth is the expensive part to build**, not the database: magic links,
token refresh, email change confirmation, and OAuth are weeks of work and a
permanent security liability if you get them wrong. RLS also lets the browser
talk to the database directly without an API layer in between, which suits a
static site.

Reconsider if you end up wanting significant server-side logic. At that point
you are running two platforms for one product, and consolidating on Workers plus
D1 with a hand-rolled session — or moving the whole app to a framework with a
server — starts to look better than the split.

### Edge Functions, rather than Cloudflare Workers, for the Stripe hooks

The functions are next to the database they write to and the auth that issues
the tokens they verify, and they deploy on their own cadence rather than with
every site change. The trade-off is a second deploy target and a second runtime
(Deno).

If you would rather keep one platform, these three functions port to Cloudflare
Workers with little change — same Web APIs, same Stripe SDK, same async
signature verification — but you would then hold the service role key in
Cloudflare and lose `verify_jwt` as a free front door.

### Magic links, rather than passwords

No password to store, leak, reset, or check against a breach list, and no
support burden. The cost is real: sign-in depends on email delivery, it is
slower, and it is awkward when someone opens the link on a different device from
the one they requested it on.

Add passwords if signups stall — Supabase supports them out of the box and the
sign-in page is the only thing that would change. **Configure your own SMTP
either way** (1.5); with magic links it is not optional.

### The free-tier cap is enforced in the database

`saved_churches`' insert policy calls `can_save_another_church()`. Putting the
check in React would have been simpler and would have given a nicer error, but
it would also be bypassable with `curl`, and entitlement checks that only exist
in the client are how people end up with paid features for free.

Two things to know about it:

- **It can be raced.** Two concurrent inserts can both see the same count and
  both pass, so someone determined can exceed the cap by a row or two. Closing
  that needs row locking or a serializable transaction, which is a poor trade
  for a soft limit on a bookmark list. Revisit if the limit ever gates something
  expensive.
- **The error is coarse.** PostgREST reports a policy refusal as `42501` with no
  detail, so the client infers "you hit the cap" from the fact that this is the
  only policy that can refuse an authenticated user's own insert. If you add
  another restriction to that policy, `SavedChurchLimitError` becomes a lie and
  you should switch to a `BEFORE INSERT` trigger that raises a distinguishable
  `SQLSTATE` instead.

### A recurring subscription, rather than one-off donations

A subscription gives predictable income and a reason for accounts to exist. It
also means dunning, cancellations, and a billing portal to maintain.

For a project like this, one-off donations are a genuinely reasonable
alternative and much less machinery: `mode: "payment"` in the checkout call, a
`payments` table instead of `subscriptions`, and no portal, no `past_due`, no
renewal logic. What you lose is the recurring relationship. A middle option is
to offer both, with a one-off "buy me a coffee" price alongside the subscription
— the checkout function already takes a plan key, so it is mostly a matter of
adding a key that maps to a one-time price and branching on `mode`.

### `status` is `text`, not an enum

An enum or a `CHECK` constraint would be better data hygiene. Both would also
mean that the day Stripe introduces a status, the webhook starts failing — and a
failing webhook means Stripe retries forever while the customer sits there
having paid and not been given access. Correctness of the money flow beats
tidiness of the column.

The set of statuses that grant access lives in one place,
`has_active_subscription()`, which is the thing you would actually want to
change.

### `past_due` keeps access

Stripe retries a failed renewal over several days. Revoking access on the first
failed charge punishes people whose card simply expired, and they are the
majority of failures. If you would rather cut access immediately, remove
`'past_due'` from `has_active_subscription()` — that one line is the whole
policy.

### Cancelled subscriptions are kept, not deleted

`customer.subscription.deleted` upserts the row with `status = 'canceled'`
rather than removing it, so the account page can say what happened and when, and
so a returning subscriber's history survives. The cost is that
`subscriptions` grows one row per subscription ever held, which is why
`pickPrimarySubscription()` exists on the client.

### The webhook claims event ids before doing work

Stripe delivers at least once. `stripe_events` is an idempotency ledger: the
handler inserts the event id, and a unique violation means "already processed,
skip". On failure it deletes the claim again so the retry is not mistaken for a
duplicate.

An upsert-only design without the ledger would also be idempotent for
subscription rows specifically, and is simpler. The ledger earns its place as
soon as a handler does anything that is not an upsert — sending a receipt email,
say — and it gives you a log of what was processed.

### The account page polls after checkout

Stripe redirects the browser back the instant payment succeeds, which is usually
before the webhook has been delivered. Showing "you're on the free plan" to
someone who has just paid is the worst possible moment to be wrong, so the page
polls entitlements for up to 30 seconds and then explains itself.

Two alternatives, both better in some way:

- **Verify the session server-side.** Pass `session_id={CHECKOUT_SESSION_ID}`
  through the success URL and add a fourth function that retrieves the session
  from Stripe and confirms it directly. Authoritative and instant, at the cost
  of another endpoint.
- **Supabase Realtime.** Subscribe to inserts on `subscriptions` and let the
  webhook's write push to the browser. Elegant, and it means enabling the
  realtime service and holding a websocket open on a page most people visit
  once.

### The client sends a plan key, never a price id

`stripe-checkout` maps `"monthly"` / `"annual"` onto `STRIPE_PRICE_MONTHLY` /
`STRIPE_PRICE_ANNUAL`. Accepting a price id from the browser — even validated
against an allow-list — would mean the set of purchasable things is defined in
two places. The cost is that adding a plan is a code change plus a secret, not
just a dashboard change.

If you expect to run frequent pricing experiments, invert it: add a function
that lists active prices from a Stripe product and have the client pass back one
of those ids, validated server-side against the same list.

### Database types are hand-written

`apps/web/src/lib/database.types.ts` is written by hand so the repository
type-checks without a linked Supabase project. Once you have one, regenerate
instead of editing:

```bash
supabase gen types typescript --linked > apps/web/src/lib/database.types.ts
```

### `saved_churches` stores a slug with no foreign key

Parish records live in the SQLite snapshot the browser downloads, not in
Postgres, so there is nothing for a foreign key to point at. A format `CHECK` is
the only integrity available, and the account page tolerates a slug that no
longer resolves.

The alternative is to have the weekly pipeline mirror `church` into Postgres,
which buys a real foreign key, lets you join saved parishes to parish data in
one query, and opens the door to server-side features like change notifications.
It also means two copies of the pipeline's output that can drift. Worth doing
when you build something that needs to know about parishes server-side, and not
before.

### Prerendered parish pages ship no JavaScript

`scripts/prerender.ts` renders each parish to static HTML with no script tag, so
a save button baked into it would look live and do nothing. The button is passed
into `ChurchPageContent` as a slot that only the interactive route fills.

The consequence is that someone arriving on a parish page from a search engine
sees no save button until they navigate within the app. Fixing that properly
means hydrating the prerendered pages, which is a change to how the site is
built and should be weighed on its own merits.

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
change. If you move the functions to secret keys, update
`createServiceClient()` in `supabase/functions/_shared/supabase.ts` — it is the
only place the service key is read.

---

## Deliberately not built

Each of these is a real gap, listed so it is a decision rather than an oversight.

- **Account deletion.** Users cannot delete their own account. `auth.users`
  cascades to every table here, so the work is an edge function that calls
  `auth.admin.deleteUser` and cancels any Stripe subscription first. Needed
  before you have EU users in any number.
- **Data export.** Same reasoning, less urgent — a saved-parish list is not much
  personal data.
- **Email change.** Supabase supports it; `config.toml` already requires
  confirmation from both addresses. There is no UI for it.
- **Anything the subscription unlocks beyond unlimited saves.** The obvious next
  feature is notifying patrons when a saved parish's schedule changes, which is
  the point at which mirroring parish data into Postgres starts to pay for
  itself.
- **Refund and dispute handling.** `charge.dispute.created` is not handled. At
  this volume, dealing with them by hand in the Stripe dashboard is fine.
- **Rate limiting on sign-in.** Supabase applies its own defaults per project;
  they are adjustable under **Authentication → Rate Limits** and worth a look
  before launch.
