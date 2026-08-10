# Project Carlo: the business and legal side

Everything that isn't code. Written against what the repository actually
contains as of August 2026: 63 parishes, 133 churches, all in New York; a static
Cloudflare-hosted React site; a weekly Gemini extraction pipeline; and a Stripe
paywall at $3/month or $30/year that is built but not switched on.

**This is not legal or tax advice.** It is a research-backed checklist of what a
solo founder in Monroe County, New York has to deal with to sell a subscription
product. Two items on it — sales tax and the bulletin-source terms of use — are
worth a paid hour with a professional. The rest you can do yourself.

---

## Contents

1. [The decision that changes everything else](#1-the-decision-that-changes-everything-else)
2. [What actually blocks the first dollar](#2-what-actually-blocks-the-first-dollar)
3. [Phase 1 — Name, brand, and the public-repo problem](#phase-1--name-brand-and-the-public-repo-problem)
4. [Phase 2 — Form the LLC](#phase-2--form-the-llc)
5. [Phase 3 — EIN, bank account, Stripe](#phase-3--ein-bank-account-stripe)
6. [Phase 4 — Taxes, including the one everyone misses](#phase-4--taxes-including-the-one-everyone-misses)
7. [Phase 5 — The site's legal surface](#phase-5--the-sites-legal-surface)
8. [Phase 6 — Data rights: your real exposure](#phase-6--data-rights-your-real-exposure)
9. [Phase 7 — Church relations](#phase-7--church-relations)
10. [Phase 8 — Insurance and liability](#phase-8--insurance-and-liability)
11. [Phase 9 — Operating hygiene and the recurring calendar](#phase-9--operating-hygiene-and-the-recurring-calendar)
12. [What it costs](#what-it-costs)
13. [A six-week sequence](#a-six-week-sequence)
14. [What not to spend money on yet](#what-not-to-spend-money-on-yet)

---

## 1. The decision that changes everything else

Before any paperwork: decide, deliberately, whether you are charging the
faithful for Mass times.

I'm not raising this to relitigate the paywall — you built it, and it's built
well. I'm raising it because the answer changes about half of this document.
Charging consumers turns on New York sales tax, auto-renewal law, refund policy,
consumer-protection exposure, and a reputational conversation with parishes
whose free bulletins are your input. Not charging consumers removes all of it.

Four postures, and what each one costs you in compliance:

| Posture | Compliance load | Notes |
|---|---|---|
| **B2C subscription** (what's built) | Highest: sales tax registration, ARL, refunds, consumer law | $3/mo has bad unit economics — Stripe takes ~13% of it |
| **B2B**: parishes/dioceses pay, faithful use free | Moderate: sales tax still applies, but ARL/consumer law mostly falls away | Fewer, larger invoices. Aligns incentives with the data owners |
| **Free + voluntary support** | Low, but **don't call it a donation** (see below) | Sponsorships and "support the project" are not charitable gifts |
| **501(c)(3) nonprofit** | High up front, low forever after | Form 1023, board, NY Charities Bureau registration. Real option given the mission, but a year of paperwork |

One trap worth naming now: **do not use the word "donation" while operating a
for-profit LLC.** Soliciting charitable contributions in New York requires
registration with the Attorney General's Charities Bureau. "Support the
project," "sponsor a parish," or plain "subscription" keep you out of that
regime entirely.

My read: the built product is worth shipping as-is, but the durable business
here is B2B. A parish or diocese paying $200/year for a maintained, accurate
schedule feed — with the public map free — sidesteps the awkwardness of a
paywall on Mass times, solves your data-rights problem by converting scraping
into permission, and needs roughly a tenth as many customers. The rest of this
plan works for either; where it differs, I say so.

---

## 2. What actually blocks the first dollar

Six things. Everything else in this document can happen after launch.

1. **Move Gemini to a paid API tier.** Google's free tier terms exclude
   commercial use — running a revenue-generating service on it requires a paid
   plan. The paid tier also stops Google from training on your inputs. At 63
   parishes a week this is a few dollars a month. This is a hard blocker.
2. **Get off the public OpenStreetMap tile server.** `ChurchMap.tsx` points
   `TileLayer` at `tile.openstreetmap.org`. The OSMF tile policy is explicit
   that commercial services should expect access to be withdrawn at any time and
   that heavy users must self-host or use a third party. If they block you, your
   paying customers get a grey map. Switch to MapTiler, Stadia, Protomaps, or
   CARTO ($0–25/month at your scale). Keep the OSM attribution either way — the
   underlying data is ODbL and attribution is required regardless of who serves
   the tiles.
3. **Terms of Service, Privacy Policy, and a refund policy, live and linked.**
   You have none. Stripe reviews for these before it will let you take live
   payments, and the ToS is where your accuracy disclaimer and liability limit
   live.
4. **A visible accuracy disclaimer** — on the church page next to the times, not
   only in the ToS. Your times are AI-extracted from PDFs. Someone will drive
   forty minutes to a Confession slot that moved.
5. **Register for New York sales tax** and turn on Stripe Tax. See
   [Phase 4](#phase-4--taxes-including-the-one-everyone-misses) — this is the
   most-missed item on the list and New York wants the application at least
   **20 days** before your first taxable sale.
6. **Decide about the public repository.** `lyonsl2/project-carlo` is public,
   has no LICENSE file, and contains `data/events.json`, `data/metadata.json`,
   `data/churches.csv`, and `apps/web/public/frontend.snapshot` — your entire
   product dataset, refreshed and re-published by GitHub Actions every Sunday.
   Anyone can clone it. See [Phase 1](#phase-1--name-brand-and-the-public-repo-problem).

Note what is *not* on this list: trademark registration, insurance, a
lawyer-drafted operating agreement, a Delaware entity. Those are Phase-2
problems that founders do first because they feel like progress.

---

## Phase 1 — Name, brand, and the public-repo problem

### 1.1 Clear the name

Do this before you file anything, because the entity name and the trademark are
easier to change now than later.

- Search USPTO's trademark database (`tmsearch.uspto.gov`) for "Carlo" in any
  class — **not** only class 9 (software), 42 (SaaS), and 45 (religious
  services). See the conflict analysis in §1.2: the class on an application does
  not bound the confusion question. Also plain-web search for anyone using the
  name for a Catholic project of any kind.
- Check New York DOS's corporate name availability search for your intended LLC
  name. Note that state entity-name availability is **not** trademark clearance —
  New York will happily register a name that infringes someone's mark.
- On the saint: Carlo Acutis was canonized in September 2025 and is associated
  with the internet and with young Catholics, so the name is apt. Nobody owns
  it. But there has been public friction about commercial exploitation of his
  name and image around the canonization, so keep the treatment devotional
  rather than brand-like: no relic imagery on a pricing page, and an About page
  that says plainly this is a project named in his honor, not one endorsed by
  anyone connected to him.

### 1.2 The "Carlo Project" conflict — probably a rename

A pending application for something like **"The Carlo Project"** — a Catholic
fundraising venture, in a class unrelated to software — turned up during name
clearance. Two instincts about that are wrong.

**The class doesn't protect you.** International Classes are an administrative
device for fees and searching, and are explicitly not determinative of likelihood
of confusion (TMEP 1207.01(d)(v)). What controls is the **goods/services wording**
in the application and whether consumers would think the two come from the same
source. Different classes are found related routinely; the same class is often
found unrelated. A registration also doesn't limit the owner to what they sell
today — the "natural zone of expansion" doctrine reaches services they would
plausibly grow into, and a Catholic fundraising outfit adding a parish-facing app
is not a stretch.

**The marks are effectively identical.** "Project Carlo" and "The Carlo Project"
differ by a transposition and an article. The TTAB regularly finds transposed
marks confusingly similar where the transposition doesn't change meaning or
commercial impression, and "The" carries no source-identifying weight. Sound,
appearance, meaning, and commercial impression all collapse together — and both
get shorthanded to "the Carlo project" in speech. That is the most heavily
weighted factor in the analysis.

Where it actually turns is relatedness. If their venture is a fundraising
*campaign or program* — money for a shrine, a school, a scholarship — nobody
expects it to share a source with a Mass-times app. If it's a fundraising
*platform sold to parishes and dioceses*, the channels of trade land directly on
the B2B path in §1 of this document: same buyers, same institutions, both digital
subscription services. Either way the audiences overlap, since both reach
Catholic laity through parish bulletins, diocesan newsletters, Catholic media,
and Google.

One point in your favor: **"Carlo" is a crowded field.** Post-canonization there
is a Netherlands catechesis "Project Carlo," a Carlo Acutis Catholic High School,
Foundation of Carlo Inc., Green Bay's Blessed Carlo Acutis Project, and schools in
Malawi, Australia, Wales, and Chile. A crowded field narrows everyone's scope of
protection. It cuts both ways: your mark would be inherently weak, and collisions
are guaranteed no matter who registers what.

One point against: priority comes from **use in commerce**, not registration, and
your use is thin. The repository dates to March 2026, the product isn't launched,
and pre-launch development generally isn't use in commerce. If they filed before
you began publicly rendering services, they likely take priority nationwide once
it registers.

**Pull the record before deciding.** From the USPTO search, get the serial number,
then read the TSDR file for: exact mark, owner, the *full* goods/services wording,
filing basis (§1(a) use-based with a claimed first-use date, or §1(b)
intent-to-use), filing date, status, and whether it has been published for
opposition. Opposition runs 30 days from publication in the Official Gazette,
extendable.

**Recommendation: rename, and do it before the LLC filing.** Not because you'd
necessarily lose a fight, but because switching cost is at its lifetime minimum —
no customers, no brand equity, no SEO, no printed material. A rename today costs a
domain, an OG image, some meta tags, and a repository rename; a rename after
launch costs all of that plus every link and every parish that has heard of you.
There's an independent reason too: *Project Carlo* tells a stranger nothing about
Mass times, which is a discovery and conversion problem for a product whose
audience searches "confession times near me." Keep Project Carlo as the internal
name and the story — it's a good story — and launch under something a searcher
understands.

If you keep it: don't file an application (it likely draws a §2(d) refusal and
announces you to them), date and preserve evidence of first public use,
differentiate hard visually, and accept that you cannot stop anyone else. A
**consent or coexistence agreement** is the cheap, friendly option — the USPTO
gives them real weight, and a Catholic nonprofit may sign one happily.

Either way, buy one trademark attorney hour ($300–500) once you have the record.
Marks this close are exactly the situation where a professional read is worth more
than the fee.

### 1.3 Lock down the domain

`projectcarlo.com` is hardcoded in `index.html` and `seo.ts`. Confirm you own
it, then: enable auto-renew, turn on registrar lock, turn on WHOIS privacy, and
enable 2FA on the registrar account. Consider defensively registering `.org`.
A lapsed domain is the one operational failure you cannot undo.

### 1.4 Fix the repository

This is the item I'd most want you to look at, because it quietly undermines the
paywall you just built.

The repository is public. There is no LICENSE file, which by default means all
rights reserved — good for you legally. But the weekly Actions job commits the
extracted schedule data and the compiled `frontend.snapshot` to a public repo.
Someone who wants your data does not need to defeat your paywall; they can
`git clone`. And `docs/auth-and-payments-setup.md` already, correctly, flags
that the snapshot is also served publicly from the CDN.

Three options:

1. **Accept it and say so.** The paywall then sells the map, the search, the
   filters, the saved parishes, and the fact that someone maintains it — not the
   bytes. Plenty of subscription products work this way. If you pick this, write
   it down so nobody (including you in six months) assumes otherwise.
2. **Split the repo.** Keep the pipeline code public — it's good work and it's
   credibility when you talk to a diocese — and move `data/` and the snapshot to
   a private repo or a private Supabase Storage bucket. This is the option I'd
   choose if you're charging.
3. **Make the whole thing private.** Simplest, loses the credibility asset.

Two things to know if you pick 2 or 3: deleting files going forward does not
remove them from git history — you'd need `git filter-repo` or a fresh
repository to truly withdraw the data that's already published. And whatever
stays public should get an explicit LICENSE file so your intent is legible.

### 1.5 Assign the IP to the LLC

After you form the entity (Phase 2), sign a one-page assignment transferring the
domain, code, trademark rights, and data compilation from you personally to the
LLC. Founders skip this constantly, and then the company doesn't own its own
product. It matters the moment anyone — a diocese, an acquirer, an insurer —
does diligence. If you ever bring in a collaborator or contractor, get the same
assignment from them in writing before they commit code.

---

## Phase 2 — Form the LLC

New York, not Delaware. Delaware buys you nothing as a single-member LLC with no
outside investors, and it costs more: you'd pay Delaware fees *and* register as a
foreign LLC in New York anyway.

Should you bother at all? For a $3/month product with no employees, a sole
proprietorship plus a solid ToS is legally not far off. The LLC is worth the
~$500 here for two specific reasons: it separates your personal assets from a
product whose entire value proposition is data accuracy, and it makes you look
like a real counterparty when you sit down with a parish business manager or a
diocesan communications office. Do it.

**Steps, in order:**

1. **Pick the name.** If the legal name isn't "Project Carlo LLC," you'll also
   want a Certificate of Assumed Name ($25) to operate publicly under
   "Project Carlo."
2. **Decide the address on the public record.** The Articles list a county and an
   address for service of process, and it becomes public. If you don't want your
   home address indexed forever, hire a commercial registered agent
   ($50–200/year) and use their address. Note that New York's Secretary of State
   is *always* an agent for service of process on a New York LLC; a commercial
   agent is about privacy, not legal necessity.
3. **File the Articles of Organization** with the NY Department of State, online
   through Business Express. **$200.** Usually processed within a few business
   days.
4. **Satisfy the publication requirement.** This is New York's quirk. Within 120
   days of formation you must publish a notice once a week for six consecutive
   weeks in **two newspapers designated by the county clerk** of the county in
   your Articles — one daily, one weekly. You don't get to pick the papers.
   Monroe County's designated papers are the *Rochester Business Journal*, the
   *Daily Record*, and the *Mendon–Honeoye Falls–Lima Sentinel*. Call the county
   clerk's office, get your assignment and quotes, then file the
   **Certificate of Publication** with the two affidavits and **$50**. Budget
   $200–700 for the ads. (Monroe County is cheap for this; the same requirement
   in Manhattan runs $1,500+.)
5. **Adopt a written operating agreement.** New York LLC law expects one even
   for a single member. A single-member template is fine — you do not need a
   lawyer for this. Sign it, date it, keep it with your records; your bank will
   ask for it.
6. **Beneficial ownership reporting: currently nothing to do, but verify.** Both
   regimes that would have applied to you have been narrowed to foreign-formed
   entities:
   - **Federal (Corporate Transparency Act / FinCEN BOI):** a March 2025 interim
     final rule redefined "reporting company" to cover only entities formed
     outside the US. US-formed LLCs and their owners are exempt. A final rule was
     expected; confirm the current state at `fincen.gov/boi` when you file.
   - **New York LLC Transparency Act:** took effect January 1, 2026, and as
     implemented applies only to LLCs formed outside the United States that
     register to do business in New York. A New York-formed LLC has no filing.
     ($25 per filing if that ever changes.)

   Check both on the day you form, because both have moved repeatedly.
7. **Calendar the Biennial Statement.** $9, every two years, to NY DOS. Trivial
   and easy to forget; missing it puts the LLC out of good standing.

---

## Phase 3 — EIN, bank account, Stripe

1. **Get an EIN from the IRS.** Free, online, instant, at `irs.gov`. Takes ten
   minutes. **Never pay a service for this** — the paid "EIN filing" sites are
   pure markup. You want an EIN even as a single-member LLC so you're not
   handing your SSN to banks and vendors.
2. **Open a business bank account.** Bring the Articles, the EIN letter, and the
   operating agreement. Mercury and Novo are free and built for exactly this;
   a local Rochester credit union is friendlier if you ever want a small loan.
   The point is not the features — it's that from day one, **every dollar of
   Project Carlo money moves through an account that is not yours personally.**
   Commingling is the single fastest way to lose the liability protection you
   just paid $500 for.
3. **Set up bookkeeping before revenue, not after.** Wave is free and enough at
   this scale; QuickBooks Solopreneur is ~$20/month. Categorize as you go:
   hosting, API costs, domain, legal/filing fees, software. Reconcile monthly.
   Your future self doing a Schedule C in April will thank you.
4. **Create the Stripe account under the LLC**, with the EIN, the business bank
   account, and the business email. If you already have a personal Stripe
   account for testing, convert it or start clean — don't run company revenue
   through a personal account.
5. **Look hard at $3/month.** Stripe's 2.9% + 30¢ on a $3 charge is 39¢ —
   **13% of revenue**, and that's before Stripe Tax's additional 0.5%. On the
   $30 annual plan it's 3.9%. Two things follow: push annual hard in the UI
   (your "two months free" note already does), and consider whether monthly
   should be $5. The 30¢ fixed component is what kills micro-subscriptions, and
   at $3 you're donating an eighth of your revenue to payment processing.

---

## Phase 4 — Taxes, including the one everyone misses

### 4.1 Income tax (straightforward)

A single-member LLC is a **disregarded entity** by default: no separate federal
return. Profit lands on **Schedule C** of your personal 1040, and you owe
**self-employment tax (15.3%)** on net earnings above $400 in addition to income
tax. Once you're profitably past a few thousand dollars, start paying
**quarterly estimated taxes** (Form 1040-ES) so April isn't a surprise.

New York adds **Form IT-204-LL**: a disregarded-entity LLC with New York-source
income owes a **$25 annual filing fee**, due by the 15th day of the third month
after year-end. It can't be prorated and is owed even in a year with no income.

Ignore S-corp election for now. It starts making sense somewhere north of
$40–50k of profit, and you are nowhere near that.

### 4.2 Sales tax (the sleeper — read this one)

**New York taxes SaaS.** The state treats remotely accessed prewritten software
as tangible personal property, taxable regardless of delivery method, and New
York courts have repeatedly upheld this — including for subscriptions bundled
with services. If you'd rather argue Project Carlo is an *information service*
than software, that's also taxable under Tax Law § 1105(c)(1): the exclusion
covers information that is personal or individual in nature, and a public
compilation of parish schedules isn't. **Both characterizations land on
taxable.** Don't spend money arguing about which.

So:

1. **Apply for a Certificate of Authority** from NYS Taxation and Finance before
   your first taxable sale. It's free. New York's stated rule is to apply at
   least **20 days before** you begin making taxable sales — so this goes on the
   calendar early, not the week you launch.
2. **Turn on Stripe Tax** (0.5% per transaction) or a specialist like Anrok or
   Numeral. Decide whether $3 is tax-inclusive or tax-on-top; Stripe supports
   both. At Monroe County's combined rate you're looking at roughly 8%.
3. **File returns on schedule even when they're zero.** New York requires the
   return whether or not you made a taxable sale. A missed zero-dollar return
   still generates penalties.
4. **Other states: not yet.** Economic nexus thresholds elsewhere are typically
   $100k in sales or 200 transactions. At $3/month you will not approach them
   for years. Stripe Tax monitors this for you. New York is the only one that
   matters on day one, because you're physically there.
5. **Spend $300–600 on one CPA conversation** before launch, specifically about
   (a) SaaS/information-service classification for your product, (b) whether to
   price tax-inclusive, and (c) the IT-204-LL and estimated-payment mechanics.
   This is the single highest-value professional hour available to you, because
   sales tax is the one item here that compounds silently — unremitted tax
   accrues with interest, and it isn't dischargeable by shutting the LLC down.

---

## Phase 5 — The site's legal surface

Everything in this phase is a build task as much as a legal one.

### 5.1 Terms of Service

Must cover, at minimum:

- **The accuracy disclaimer, prominently.** Schedules are automatically
  extracted from parish bulletins by software and may be incomplete, outdated,
  or wrong; always confirm with the parish. Say it in the ToS *and* in the UI.
- **Subscription terms**: price, billing period, that it renews automatically,
  how to cancel, and what happens at trial end.
- **Refund policy.** Pick one and state it. "No refunds on partial periods;
  cancel any time and keep access through the period you paid for" is honest and
  standard. Stripe wants to see this.
- **Limitation of liability and disclaimer of warranties.** This is the clause
  that matters if someone claims they missed an obligation because of your data.
- **No affiliation.** Project Carlo is not affiliated with, endorsed by, or
  sponsored by the Catholic Church, any diocese, or any parish. Put this in the
  footer too.
- **A parish takedown path.** A named email address where a parish can ask to be
  corrected or removed, and a commitment to act on it quickly. This is worth
  more to you than any clause a lawyer will write — it's the thing that keeps a
  complaint from becoming a letter.
- **Acceptable use / no scraping** of your own service, governing law (New York),
  and 18+ to subscribe.

Consider skipping an arbitration clause. It's protective in theory, and for a
product at this scale mostly signals distrust to an audience whose goodwill is
your distribution channel.

### 5.2 Privacy Policy

Inventory what you actually touch, which is refreshingly little:

| Data | Where it goes |
|---|---|
| Email address (magic-link sign-in) | Supabase Auth |
| Saved parishes | Supabase Postgres |
| Payment details | **Stripe only** — you never hold card data |
| Browser geolocation ("near me") | Stays client-side; disclose and require consent |
| Place-search queries | Geoapify |
| Feedback submissions | Tally |
| Request logs | Cloudflare |
| Bulletin PDFs | Google (Gemini API) — no user data involved |

That list is your subprocessor disclosure. Add retention periods, a deletion
path, and a real contact address. Note that holding no card data and no names is
a genuine asset — say so.

**CCPA/CPRA and GDPR:** neither applies at your size (CPRA thresholds are $25M
revenue or 100k consumers). But a privacy policy is expected regardless, and if
you start selling into the EU you'll need lawful-basis language. Keep it US-only
at first and revisit.

**Cookie banner:** you appear to run no analytics and no tracking cookies. If
that holds, you don't need a banner — functional localStorage for map state
doesn't trigger consent. If you add analytics, pick a cookieless one (Plausible,
Fathom) and keep it that way.

### 5.3 Account deletion

You have an account page and no way to delete an account. Add it: delete the
Supabase user, the saved parishes, and cancel the Stripe subscription. This is
expected practice, is required by several state privacy laws once you're bigger,
and is trivially easier to build now than to retrofit.

### 5.4 Auto-renewal law — you have one real gap

New York's automatic renewal law (GBL §§ 527, 527-a, amended effective
November 5, 2025) requires clear and conspicuous terms, affirmative consent, and
online cancellation for anyone who signed up online. **Your architecture already
handles most of this well**, and it's worth noticing why: the trial takes no card
and *pauses* rather than charging, so the classic auto-renewal complaint — a
surprise charge after a free trial — structurally cannot happen to you. The
Stripe Customer Portal (`stripe-portal`) satisfies online cancellation.

The gap: **the annual plan needs a pre-renewal reminder.** New York requires
notice 15–45 days before the cancellation deadline for any auto-renewal of a
year or longer, with cancellation instructions. Nothing in the repo sends it.
That's a Stripe webhook plus a transactional email, and it needs to exist before
you sell an annual subscription. Separately, material changes — price increases
especially — need notice 5–30 days ahead.

Two more notes on the landscape:

- The FTC's federal "click-to-cancel" rule was vacated by the Eighth Circuit in
  July 2025 and there is no federal negative-option rule in force; ROSCA still
  applies, and the FTC restarted rulemaking in 2026. Don't build to a vacated
  rule, but don't assume the topic is closed.
- **New York City adopted its own click-to-cancel rule, effective October 1,
  2026.** It requires all material terms — price, frequency, cancellation
  deadline, cancellation methods — presented clearly before you ask for consent
  or billing details. You will have NYC subscribers. Design the checkout to meet
  it; the requirements are good practice anyway.

### 5.5 Accessibility

Aim for WCAG 2.1 AA. Paid consumer websites do attract ADA demand letters, and
the fix list is usually short: run axe DevTools, check color contrast on the
parchment palette (warm low-contrast schemes fail often), verify keyboard
navigation through the map and filter panel, and label the form controls. A few
hours of work that removes a whole category of nuisance risk.

### 5.6 Email

Magic links and receipts are transactional, so CAN-SPAM's unsubscribe rules
don't bind them — but the moment you send anything promotional it needs an
unsubscribe link and a physical mailing address. Set up SPF, DKIM, and DMARC on
`projectcarlo.com` before launch or your sign-in links will land in spam, which
for a magic-link-only product is a total outage.

---

## Phase 6 — Data rights: your real exposure

This is the part of the business a lawyer would actually want to talk about, and
it is not the part founders worry about.

### 6.1 Copyright: you're on solid ground

Mass times, Confession hours, addresses, and Adoration schedules are **facts**.
Under *Feist Publications v. Rural Telephone Service* (1991), facts aren't
copyrightable, and a compilation of facts is protected only in its original
selection and arrangement. Extracting event times from a bulletin PDF and
re-presenting them in your own schema is squarely within that. Your architecture
already does the right things — parsing to structured events rather than copying
prose.

Keep it that way:

- **Don't rehost the PDFs.** Your README says downloaded PDFs stay untracked.
  Good — keep them local to the pipeline and never serve them.
- **Don't reproduce bulletin prose, images, or layout.** Factual strings only.
- **Attribute and link.** Name the parish, link to their site and the source
  bulletin. It's better UX and it's evidence of good faith.

### 6.2 Terms of use: the actual risk

Your pipeline fetches from `parishesonline.com` / `container.parishesonline.com`,
`files.ecatholic.com`, and `bulletins.discovermass.com`. Copyright isn't the
exposure here; **contract is.** Platform terms of use commonly prohibit
automated access, and a breach-of-terms claim doesn't care that the underlying
facts are unprotectable. (Computer Fraud and Abuse Act claims over public,
un-authenticated pages are weak after *Van Buren* and *hiQ v. LinkedIn* — that's
not your worry. The terms are.)

Note who you're dealing with: **ParishesOnline and DiscoverMass are both LPi
properties.** LPi is simultaneously your largest data source, a potential
partner, and your closest competitor. Building a paid product on automated
collection from a competitor's platform is the highest-risk single fact about
this business.

Action items:

1. **Read all three sites' terms of use yourself.** I couldn't fetch them from
   this environment. Look specifically for clauses on automated access,
   crawling, scraping, robots, and commercial use. Write down what you find.
2. **Check and honor each site's `robots.txt`.** I don't see robots handling in
   `fetch.py` or `detect.py`. Whether or not robots.txt binds you legally,
   ignoring it is the fact that makes a scraping story sound bad.
3. **Prefer the parish's own site over the aggregator** wherever the bulletin is
   reachable there. Your `parishes.csv` already tracks provider per parish;
   biasing toward first-party sources reduces platform dependency and platform
   risk at once.
4. **Keep the polite-crawler posture you already have.** `geocode.py` and
   `fetch.py` set honest, identifying User-Agents that link back to the repo.
   Keep that, add rate limiting and caching, and run weekly rather than more
   often — you already do.
5. **Be ready to stop instantly.** Write down, now, that a takedown or blocking
   request from a platform or a parish gets honored within 48 hours, and build
   the ability to drop a parish from the pipeline without a code change. Then
   actually honor it. A documented compliance policy is what turns a legal
   threat into an email exchange.
6. **The durable fix is permission.** One diocesan agreement converts your legal
   posture from "scraper" to "partner," and it's also the B2B business. See
   Phase 7.

### 6.3 Vendor terms you're currently outside of

Three concrete ones, all fixable in an afternoon:

- **Gemini free tier prohibits commercial use.** Move to paid before you charge.
  Also relevant: the free tier lets Google use your inputs and outputs for
  product improvement, with human review; the paid tier doesn't.
- **OSM public tile server.** Covered in [§2](#2-what-actually-blocks-the-first-dollar).
  Move to a commercial provider, keep the ODbL attribution.
- **Nominatim for geocoding.** `geocode.py` calls
  `nominatim.openstreetmap.org`. Their usage policy forbids systematic or bulk
  geocoding and is aimed at non-commercial use. Move the batch geocoding to
  Geoapify — you already have a key — or another paid geocoder.

And one trap specific to what you're doing: **check whether your geocoder's
terms let you store the results.** You commit latitude and longitude into
`data/churches.csv` permanently, in a public repo. Geoapify's paid plans permit
storing geocoding results; **Google's terms famously do not** (a 30-day cache
limit), and several others restrict it too. If you ever swap geocoders, check
this clause first — it's an easy, invisible violation.

---

## Phase 7 — Church relations

No filing fee, and more consequential than everything in Phase 2.

**Reach out to the Diocese of Rochester before someone forwards them your
pricing page.** Their communications office is the right first contact. Go in
with: what it is, that it reads their parishes' public bulletins, that you'll
correct or remove anything on request, and an offer of free access for parish
staff. Ask what would make it useful to them.

Expect the obvious objection — *you're charging for our Mass times.* Have a real
answer before you're asked. The good answers are structural, not rhetorical:
keep the map free and charge for something else; let parishes sponsor their own
listing; or sell to the diocese and give it away to the faithful.

Other work here:

- **Recruit three to five pastors or parish business managers as design
  partners.** They are your correction pipeline, your credibility, and — via
  bulletin announcements and pulpit mentions — the best distribution channel a
  product like this has. Nothing you can buy competes with a pastor
  recommending it.
- **Never imply endorsement.** No diocesan crests, no "official," and a plain
  no-affiliation line in the footer. Also: if a parish's data is wrong, the
  parish gets blamed, not you — which is exactly why fast corrections are a
  relationship issue and not just a support issue.
- **Your correction loop is already half-built.** Tally collects feedback with
  `church_slug` context. Commit to a turnaround time publicly and hit it.

---

## Phase 8 — Insurance and liability

Honest assessment: at your size the LLC, a competent limitation-of-liability
clause, and the fact that you hold almost no personal data *is* most of your
protection.

The two real exposures, in order:

1. **A breach of subscriber emails.** Small, but it's the one that generates an
   actual claim, and it's the one insurance covers well.
2. **Reliance on wrong data.** Realistically a reputational injury, not a
   litigable one — someone who misses Mass has no damages. Your disclaimer and
   your correction speed are the mitigation here, not a policy.

So: **defer insurance until you have revenue**, then get **tech E&O /
professional liability with a cyber endorsement** — roughly $500–1,500/year from
Vouch, Coalition, or Hiscox. General liability is close to pointless with no
premises and no in-person operations. If you go B2B, note that diocesan or
institutional contracts often *require* you to carry E&O with a stated limit, so
a first enterprise customer may set the timing for you.

---

## Phase 9 — Operating hygiene and the recurring calendar

**Set up once:**

- A business email on the domain (`support@projectcarlo.com` and
  `hello@`) — needed for the ToS contact, Stripe, and looking real to a parish.
  Google Workspace or Fastmail.
- A password manager, and 2FA on every one of: registrar, Cloudflare, Stripe,
  Supabase, GitHub, Google Cloud, and the bank. Your Stripe account and your
  domain are the two keys to the business.
- A records folder — digital is fine — holding the Articles, EIN letter,
  operating agreement, publication affidavits and Certificate of Publication,
  the IP assignment, biennial statement receipts, tax returns, and any parish or
  diocesan correspondence.

**Put on a calendar with reminders:**

| Recurring | Cadence |
|---|---|
| NY sales tax return (even at $0) | Quarterly, per your assigned filing frequency |
| Federal estimated tax (1040-ES) | Quarterly, once profitable |
| Schedule C with your 1040 | Annually, April |
| NY Form IT-204-LL ($25) | Annually, 15th day of 3rd month after year-end |
| NY Biennial Statement ($9) | Every 2 years |
| Domain renewal | Annually — belt and braces on top of auto-renew |
| Bookkeeping reconciliation | Monthly |
| Re-check FinCEN BOI and NY LLCTA status | Annually |

**One thing worth writing into the ToS now:** what happens if you stop. A
sentence committing to 30 days' notice and a pro-rata refund of prepaid annual
subscriptions costs you nothing today, is honest, and prevents the worst version
of winding down. Don't take annual prepayments you couldn't refund.

---

## What it costs

| Item | Cost | When |
|---|---|---|
| USPTO / name searches | $0 | Before filing |
| NY Articles of Organization | $200 | Formation |
| Newspaper publication (2 papers, 6 weeks, Monroe County) | $200–700 | Within 120 days |
| Certificate of Publication | $50 | With affidavits |
| Registered agent (optional, for address privacy) | $50–200/yr | Formation |
| Certificate of Assumed Name (if name differs) | $25 | Formation |
| Operating agreement (template) | $0 | Formation |
| EIN | $0 | After Articles |
| Business bank account (Mercury/Novo) | $0 | After EIN |
| Bookkeeping (Wave / QuickBooks) | $0–20/mo | Immediately |
| NY sales tax Certificate of Authority | $0 | 20+ days pre-launch |
| CPA consultation | $300–600 | Pre-launch |
| ToS + Privacy (generator like Termly) | $0–200/yr | Pre-launch |
| ToS + Privacy (lawyer-drafted SaaS package) | $1,500–3,500 | Optional |
| Map tiles (MapTiler/Stadia/Protomaps) | $0–25/mo | Pre-launch |
| Gemini paid tier | ~$5–20/mo at current volume | Pre-launch |
| Stripe fees | 2.9% + 30¢ per charge | Per transaction |
| Stripe Tax | 0.5% per transaction | Per transaction |
| NY Biennial Statement | $9 / 2 yrs | Ongoing |
| NY IT-204-LL | $25/yr | Ongoing |
| Trademark registration (TEAS Plus, 1 class) | $350 + optional $500–1,500 attorney | Defer |
| Tech E&O + cyber insurance | $500–1,500/yr | Defer until revenue |

**Realistic all-in to launch legitimately: $600–1,000 doing it yourself**, or
$3,000–5,000 with a lawyer on the documents. Ongoing fixed costs are under
$50/month.

---

## A six-week sequence

Ordered by dependency, not by importance — you can't open a bank account before
you have an EIN, and you can't have an EIN before the Articles.

**Week 1 — decisions and clearances**
Settle the pricing posture from §1. Pull the "Carlo Project" application from
TSDR and **settle the name** — this gates the entity name, the domain, and the
repo, so it can't wait. Run the remaining USPTO and NY name searches. Confirm and
lock the domain for whatever name wins. Decide the repo question and, if
splitting, start moving `data/` out. Apply for the **NY Certificate of
Authority** — it has the longest lead time on this list, so it goes first, not
last.

**Week 2 — form the entity**
File the Articles ($200). Get the EIN the day they're approved. Sign the
operating agreement and the IP assignment. Call the Monroe County clerk about
publication and get quotes. Check FinCEN and NY LLCTA status.

**Week 3 — money plumbing**
Open the business bank account. Set up bookkeeping. Create the Stripe account
under the LLC. Start the newspaper publication clock — it runs six weeks in the
background from here. Have the CPA conversation.

**Week 4 — vendor compliance (all code)**
Move Gemini to a paid tier. Swap the tile provider. Move geocoding off
Nominatim. Read and record the three bulletin platforms' terms; add robots.txt
handling and a way to drop a parish without a deploy.

**Week 5 — the legal surface (all code)**
Write the ToS, Privacy Policy, and refund policy; link them in the footer and at
checkout. Add the accuracy disclaimer to the church page. Build account
deletion. Build the annual pre-renewal reminder email. Fill in the About page —
it's still placeholder lorem, and it's where the no-affiliation and
contact-us lines belong. Run axe and fix what it finds.

**Week 6 — launch and outreach**
Turn on Stripe Tax and go live with Stripe. Email the Diocese of Rochester.
Contact three parishes about being design partners. File the Certificate of
Publication when the affidavits arrive.

---

## What not to spend money on yet

- **Trademark registration.** Do the searches now; file when the name has value
  worth defending.
- **A Delaware entity.** Costs more, buys nothing without outside investors.
- **A lawyer-drafted operating agreement.** A single-member template is fine.
- **S-corp election.** Revisit past ~$40–50k of profit.
- **Insurance.** After revenue, or when a B2B customer requires it.
- **A trademark attorney, a general-liability policy, a payroll provider, or a
  registered agent in states you don't operate in.** All of these are things
  founders buy to feel like a company.

The two places money is well spent right now are the CPA hour on sales tax, and
— if you want one paid legal hour — a look at the bulletin-platform terms of use
alongside your pipeline. Those are the two items on this list that get more
expensive the longer they go unexamined.

---

## Sources

Formation and reporting: [NY LLC publication requirement](https://www.wolterskluwer.com/en/expert-insights/new-yorks-llc-publication-requirement-what-you-need-to-know) ·
[Monroe County designated newspapers](https://www.monroecounty.gov/clerk-publications) ·
[NY LLC Transparency Act limited to non-US LLCs](https://www.hklaw.com/en/insights/publications/2026/01/new-york-llc-transparency-act-reporting-limited) ·
[NY LLCTA effective date and deadlines](https://www.crowell.com/en/insights/client-alerts/new-york-llc-transparency-act-key-requirements-and-deadlines) ·
[FinCEN BOI reporting](https://www.fincen.gov/boi)

Tax: [NY reaffirms SaaS taxable as prewritten software](https://taxcloud.com/sales-tax-radar/new-york-saas-sales-tax-as-prewritten-software-2026/) ·
[NY appellate decision on SaaS bundled with services](https://www.alston.com/en/insights/publications/2026/01/new-york-saas-tax-prewritten-computer-software) ·
[NY sales & use tax guide for software and SaaS (NYSSCPA)](https://www.nysscpa.org/docs/default-source/pdf/a-new-york-sales-use-tax-guide-for-computer-software-and-saas---sales-tax-helper-llc.pdf) ·
[How to register for NYS sales tax](https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/how_to_register_for_nys_sales_tax.htm) ·
[Form IT-204-LL instructions](https://www.tax.ny.gov/forms/current-forms/it/it204lli.htm)

Subscriptions: [NY and Colorado auto-renewal updates](https://perkinscoie.com/insights/update/new-york-and-colorado-update-auto-renewing-subscription-requirements) ·
[NYC click-to-cancel rule vs. NY and CA](https://www.loeb.com/en/insights/passle/2026/07/nycs-new-clicktocancel-rule-how-it-stacks-up-to-new-york-state-and-california-and-whats-next-from-th) ·
[NYC DCWP click-to-cancel rule (adopted)](https://www.nyc.gov/content/dam/nycgov/nyc-main/pdf/2026/Click-to-Cancel-Rule.pdf) ·
[Auto-renewal legal landscape mid-2026](https://www.zwillgen.com/auto-renewal/auto-renewal-update-legal-landscape-imposes-complex-obligations-subscription-businesses/)

Vendors: [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) ·
[Gemini API commercial use and data policies by tier](https://terms.law/ai-output-rights/gemini/)
