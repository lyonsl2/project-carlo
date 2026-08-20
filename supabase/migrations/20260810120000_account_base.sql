-- Account foundation: a public.profiles row mirroring each auth.users row.
--
-- auth.users is owned by Supabase Auth and is not directly readable through
-- PostgREST, so every user-facing table joins against public.profiles instead.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application-visible mirror of auth.users. Populated by the on_auth_user_changed trigger.';
comment on column public.profiles.email is
  'Copied from auth.users; not writable by the user (see column grants below).';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Keep profiles in step with auth.users on both signup and email change. Runs
-- as the definer because the trigger fires under whatever role Supabase Auth
-- used for the insert, which has no rights on public.profiles.
create or replace function public.handle_auth_user_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_changed on auth.users;
create trigger on_auth_user_changed
  after insert or update of email on auth.users
  for each row execute function public.handle_auth_user_changed();

alter table public.profiles enable row level security;

create policy "Profiles are readable by their owner"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Profiles are updatable by their owner"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Inserts and deletes are the trigger's and the auth.users cascade's job, so no
-- policy is granted for them: with RLS on, an absent policy denies the command.

-- Defence in depth behind RLS. Supabase grants the API roles broad DML on new
-- public tables by default; narrow that to exactly what the app needs, so a
-- future policy mistake still cannot let a user rewrite their own email (which
-- is what identifies them to Stripe) or read the table anonymously.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
