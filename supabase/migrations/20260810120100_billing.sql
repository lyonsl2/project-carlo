-- Stripe billing state, mirrored into Postgres by the stripe-webhook function.
--
-- Stripe is the source of truth for everything with a card behind it, including
-- the default trial: a new account that gives a card gets a Stripe subscription
-- in `trialing`, and Stripe decides when it converts. Nothing here can extend
-- it. The one thing Stripe does not own is the card-free trial someone gets by
-- declining the card form, which has no Stripe object at all and lives in
-- public.trials — see 20260810120300_trials.sql.
--
-- Nothing below is written by the browser: every table grants the API roles
-- read access at most, and the webhook writes with the service role, which
-- bypasses RLS.

create table if not exists public.stripe_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.stripe_customers is
  'Maps a Supabase user to their Stripe Customer. Written by the webhook once a
   checkout completes, so an abandoned one leaves nothing behind here or in Stripe.';

create table if not exists public.subscriptions (
  -- Stripe subscription id (sub_...), so redelivered webhooks upsert in place.
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text not null,
  -- Deliberately free-form text rather than an enum or a check constraint: a
  -- status Stripe adds later must not make the webhook fail, because a failing
  -- webhook means Stripe retries forever and the customer never gets access.
  -- Known values: incomplete, incomplete_expired, trialing, active, past_due,
  -- canceled, unpaid, paused.
  status text not null,
  price_id text,
  product_id text,
  quantity integer,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  -- Stamped by the webhook the first time Stripe reports this subscription as
  -- active, which cannot happen until an invoice has been paid. It is what
  -- separates "a card failed on renewal" from "the trial ended and the card
  -- they added was declined" — see has_access().
  first_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'Projection of Stripe subscriptions. Written only by the stripe-webhook function.';
comment on column public.subscriptions.first_paid_at is
  'When this subscription first reached `active`, i.e. first successful payment.';

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_user_status_idx on public.subscriptions (user_id, status);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

/** Records the first time a subscription is reported active, and refuses to
 *  let that record be lost afterwards.
 *
 *  Enforced here rather than in the webhook because the webhook upserts whole
 *  rows from Stripe, and Stripe has no idea when we first saw a payment. A
 *  trigger keeps the invariant true no matter which code path does the write. */
create or replace function public.stamp_first_paid_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.first_paid_at is not null then
    new.first_paid_at := old.first_paid_at;
  elsif new.status = 'active' and new.first_paid_at is null then
    new.first_paid_at := now();
  end if;
  return new;
end;
$$;

create trigger subscriptions_stamp_first_paid_at
  before insert or update on public.subscriptions
  for each row execute function public.stamp_first_paid_at();

-- Webhook idempotency ledger. Stripe delivers at least once, so the handler
-- claims an event id here before doing any work and skips duplicates.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

comment on table public.stripe_events is
  'Processed Stripe event ids. Insert conflicts mark a redelivery the handler can skip.';

alter table public.stripe_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;

create policy "Customers are readable by their owner"
  on public.stripe_customers for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Subscriptions are readable by their owner"
  on public.subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- stripe_events gets no policy at all: RLS is on and only the service role,
-- which bypasses it, ever touches the table.

revoke all on table public.stripe_customers from anon, authenticated;
revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.stripe_events from anon, authenticated;
grant select on table public.stripe_customers to authenticated;
grant select on table public.subscriptions to authenticated;

/** The single entitlement question the rest of the schema asks.
 *
 *  Replaced in 20260810120300_trials.sql, which adds the card-free trial as a
 *  second source of entitlement. The Stripe half below is unchanged.
 *
 *  `trialing` covers a trial with a card already attached. `paused` — where
 *  Stripe puts a subscription whose trial ended without a usable payment
 *  method — deliberately does not.
 *
 *  `past_due` counts only once a payment has actually succeeded. Stripe retries
 *  a failed renewal for days, and cutting a long-standing subscriber off the
 *  moment their card expires is a bad trade. But a trial that ends with a
 *  declining card also lands in `past_due`, and that must not buy access, so
 *  the grace period is limited to subscriptions that have paid at least once.
 */
create or replace function public.has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = (select auth.uid())
      and (
        s.status in ('trialing', 'active')
        or (s.status = 'past_due' and s.first_paid_at is not null)
      )
  );
$$;

comment on function public.has_access() is
  'True when the calling user may use the product. Takes no argument on purpose,
   so one user cannot probe another user''s billing state.';

revoke all on function public.has_access() from public;
grant execute on function public.has_access() to authenticated;
