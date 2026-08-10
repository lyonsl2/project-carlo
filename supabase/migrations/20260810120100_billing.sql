-- Stripe billing state, mirrored into Postgres by the stripe-webhook function.
--
-- Stripe stays the source of truth. Nothing here is written by the browser:
-- every table below grants the API roles read access at most, and the webhook
-- writes with the service role, which bypasses RLS.

create table if not exists public.stripe_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.stripe_customers is
  'Maps a Supabase user to the Stripe Customer created for them at first checkout.';

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'Projection of Stripe subscriptions. Written only by the stripe-webhook function.';

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_user_status_idx on public.subscriptions (user_id, status);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

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

-- Statuses that keep a subscriber entitled. `past_due` is included on purpose:
-- Stripe retries a failed renewal for days, and revoking access on the first
-- failed charge punishes people whose card simply expired. Drop it here if you
-- would rather cut access immediately.
create or replace function public.has_active_subscription()
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
      and s.status in ('active', 'trialing', 'past_due')
  );
$$;

comment on function public.has_active_subscription() is
  'True when the calling user has a subscription in an entitled status. Takes no
   argument on purpose, so one user cannot probe another user''s billing state.';

revoke all on function public.has_active_subscription() from public;
grant execute on function public.has_active_subscription() to authenticated;
