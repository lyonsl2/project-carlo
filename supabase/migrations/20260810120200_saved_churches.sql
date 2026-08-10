-- Saved parishes: the first piece of per-user data, and the thing the paid tier
-- unlocks more of.
--
-- Parish records live in the SQLite snapshot the browser downloads, not in
-- Postgres, so there is no foreign key to point at. The slug is the join key
-- and a format check is the only integrity Postgres can offer here. Mirroring
-- the church table into Postgres would buy a real FK at the cost of keeping two
-- copies of the pipeline's output in step.
create table if not exists public.saved_churches (
  user_id uuid not null references auth.users (id) on delete cascade,
  church_slug text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, church_slug),
  constraint saved_churches_slug_format
    check (church_slug ~ '^[a-z0-9][a-z0-9-]{0,127}$')
);

comment on table public.saved_churches is
  'Parishes a user has saved, keyed by the slug used in the frontend snapshot.';

create index if not exists saved_churches_user_id_idx on public.saved_churches (user_id);

create or replace function public.free_saved_church_limit()
returns integer
language sql
immutable
set search_path = ''
as $$ select 3 $$;

comment on function public.free_saved_church_limit() is
  'How many parishes an account without a subscription may save. Single source of
   truth: the insert policy enforces it and account_entitlements() reports it.';

grant execute on function public.free_saved_church_limit() to authenticated;

-- Entitlement check used by the insert policy. Enforcing the free-tier cap in
-- the database rather than the client means a hand-written API call cannot slip
-- past it.
--
-- Known trade-off: two concurrent inserts can both observe the same count and
-- both pass, so a determined user can exceed the cap by a row or two. Closing
-- that needs row locking or a serializable transaction, which is a poor deal
-- for a soft limit on a bookmark list.
create or replace function public.can_save_another_church()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  saved_count integer;
begin
  if uid is null then
    return false;
  end if;

  if public.has_active_subscription() then
    return true;
  end if;

  select count(*) into saved_count
  from public.saved_churches
  where user_id = uid;

  return saved_count < public.free_saved_church_limit();
end;
$$;

revoke all on function public.can_save_another_church() from public;
grant execute on function public.can_save_another_church() to authenticated;

alter table public.saved_churches enable row level security;

create policy "Saved parishes are readable by their owner"
  on public.saved_churches for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Saved parishes are insertable by their owner within their plan"
  on public.saved_churches for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and public.can_save_another_church()
  );

create policy "Saved parishes are deletable by their owner"
  on public.saved_churches for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No update policy: a saved parish is only ever added or removed, and letting
-- a row be re-pointed at a different slug would sidestep the insert-time cap.

revoke all on table public.saved_churches from anon, authenticated;
grant select, insert, delete on table public.saved_churches to authenticated;

-- One round trip for everything the account UI needs to render, so the client
-- never has to hardcode the free-tier number or re-derive "is this user a
-- patron" from raw subscription rows.
create or replace function public.account_entitlements()
returns table (
  is_patron boolean,
  saved_count integer,
  -- null means unlimited
  saved_limit integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.has_active_subscription() as is_patron,
    (
      select count(*)::integer
      from public.saved_churches sc
      where sc.user_id = (select auth.uid())
    ) as saved_count,
    case
      when public.has_active_subscription() then null
      else public.free_saved_church_limit()
    end as saved_limit;
$$;

revoke all on function public.account_entitlements() from public;
grant execute on function public.account_entitlements() to authenticated;
