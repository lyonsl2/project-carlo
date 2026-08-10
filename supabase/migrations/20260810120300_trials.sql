-- The card-free trial, for people who decline the card form.
--
-- The default trial is a Stripe subscription in `trialing` with a card already
-- attached, and it needs nothing here. This table is what "Maybe later" buys:
-- the same seven days, with no Stripe object at all behind them. An account
-- that never enters payment details therefore leaves no customer and no
-- subscription in Stripe — the whole point of keeping this in Postgres.
--
-- The two trials are the same window, not two windows. Adding a card partway
-- through a card-free trial hands Stripe this row's `ends_at` as the
-- subscription's `trial_end`, so nobody gets fourteen days by taking the long
-- way round. See supabase/functions/_shared/checkoutAction.ts.

create table if not exists public.trials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null
);

comment on table public.trials is
  'Card-free trials. One row per account, ever, written only by public.start_trial().';
comment on column public.trials.ends_at is
  'When access from this trial stops. Also handed to Stripe as trial_end if a card arrives before then.';

alter table public.trials enable row level security;

create policy "Trials are readable by their owner"
  on public.trials for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert, update, or delete policy, and no DML grant: public.start_trial()
-- is the only way a row gets here. A writable `ends_at` would be a free
-- subscription for anyone with the anon key and a terminal.
revoke all on table public.trials from anon, authenticated;
grant select on table public.trials to authenticated;

/** Starts the card-free trial for the calling user, and returns when it ends.
 *
 *  Security definer because public.trials is deliberately not writable through
 *  the API: the end date has to be computed here or a user could grant
 *  themselves a decade.
 *
 *  One per account, ever. Calling twice returns the original end date rather
 *  than extending it, and an account that has already been to Stripe is refused
 *  outright — whatever it has there is its trial.
 *
 *  The seven days below are the same seven as TRIAL_PERIOD_DAYS in
 *  supabase/functions/_shared/plans.ts and apps/web/src/lib/plans.ts. Change
 *  all three together.
 */
create or replace function public.start_trial()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  trial_ends_at timestamptz;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select t.ends_at into trial_ends_at
    from public.trials t where t.user_id = uid;
  if found then
    return trial_ends_at;
  end if;

  if exists (select 1 from public.subscriptions s where s.user_id = uid) then
    raise exception 'This account already has a subscription in Stripe'
      using errcode = '42501';
  end if;

  -- Losing a race with a double-clicked button must not raise, and must not
  -- move the end date, so the loser re-reads the winner's row.
  insert into public.trials (user_id, ends_at)
    values (uid, now() + interval '7 days')
    on conflict (user_id) do nothing
    returning ends_at into trial_ends_at;

  if trial_ends_at is null then
    select t.ends_at into trial_ends_at
      from public.trials t where t.user_id = uid;
  end if;

  return trial_ends_at;
end;
$$;

comment on function public.start_trial() is
  'Starts the card-free trial for the calling user. Idempotent, and refused once
   the account has any Stripe subscription.';

revoke all on function public.start_trial() from public;
grant execute on function public.start_trial() to authenticated;

/** Replaces the definition in 20260810120100_billing.sql to add the card-free
 *  trial as a second source of entitlement. Everything about the Stripe half is
 *  unchanged; see that migration for why `paused` and an unpaid `past_due` are
 *  excluded. */
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
  ) or exists (
    select 1
    from public.trials t
    where t.user_id = (select auth.uid())
      and t.ends_at > now()
  );
$$;

comment on function public.has_access() is
  'True when the calling user may use the product: a live Stripe subscription,
   or a card-free trial that has not run out. Takes no argument on purpose, so
   one user cannot probe another user''s billing state.';

revoke all on function public.has_access() from public;
grant execute on function public.has_access() to authenticated;

-- Gains trial_ends_at so the account page can render the countdown from the
-- same round trip the route gate already makes. Dropped rather than replaced
-- because the return type changes.
drop function if exists public.account_entitlements();

create function public.account_entitlements()
returns table (
  has_access boolean,
  saved_count integer,
  trial_ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.has_access() as has_access,
    (
      select count(*)::integer
      from public.saved_churches sc
      where sc.user_id = (select auth.uid())
    ) as saved_count,
    (
      select t.ends_at
      from public.trials t
      where t.user_id = (select auth.uid())
    ) as trial_ends_at;
$$;

revoke all on function public.account_entitlements() from public;
grant execute on function public.account_entitlements() to authenticated;
