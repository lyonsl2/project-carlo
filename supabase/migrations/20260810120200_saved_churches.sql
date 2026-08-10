-- Saved parishes: the first piece of per-user data.
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

alter table public.saved_churches enable row level security;

create policy "Saved parishes are readable by their owner"
  on public.saved_churches for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Reading stays open to the owner even once their access lapses, so the account
-- page can still show what they had. Writing needs a live trial or paid
-- subscription: the check belongs here rather than in the client, where anyone
-- with a token and a terminal could skip it.
create policy "Saved parishes are insertable by owners with access"
  on public.saved_churches for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and public.has_access()
  );

create policy "Saved parishes are deletable by their owner"
  on public.saved_churches for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No update policy: a saved parish is only ever added or removed.

revoke all on table public.saved_churches from anon, authenticated;
grant select, insert, delete on table public.saved_churches to authenticated;

-- One cheap round trip for the question every gated route has to ask before it
-- renders. The account page reads the subscription rows themselves for the
-- detail; this is deliberately just the verdict.
create or replace function public.account_entitlements()
returns table (
  has_access boolean,
  saved_count integer
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
    ) as saved_count;
$$;

revoke all on function public.account_entitlements() from public;
grant execute on function public.account_entitlements() to authenticated;
