-- Minimal stand-in for the parts of a Supabase database that the migrations in
-- supabase/migrations depend on: the API roles, the auth schema, auth.uid(),
-- and Supabase's default privileges on the public schema.
--
-- Only used by scripts/db-test-local.sh, which runs the pgTAP suite against a
-- plain PostgreSQL server so the policies can be tested without Docker. The
-- real database gets all of this from Supabase itself, and `supabase test db`
-- runs the same suite in supabase/tests against it.

-- ---------------------------------------------------------------- API roles

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Matches Supabase: the service role bypasses RLS entirely.
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase hands the API roles blanket DML on every new table in public. The
-- migrations revoke that again on purpose, so the shim has to reproduce the
-- permissive starting point or the revokes would be testing nothing.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- --------------------------------------------------------------- auth schema

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- PostgREST publishes the JWT payload as the request.jwt.claims GUC; these are
-- the same definitions Supabase ships.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create extension if not exists pgtap;
