-- Row Level Security suite for the account and billing tables.
--
--   supabase test db                 (against the local Supabase stack)
--   ./scripts/db-test-local.sh       (against a plain PostgreSQL server)
--
-- Everything runs inside one transaction that is rolled back at the end, so the
-- fixtures never persist. Each block resets to the owning superuser role before
-- switching, because the API roles are NOINHERIT and cannot SET ROLE themselves.

begin;
select plan(48);

-- ------------------------------------------------------------------ fixtures

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test');

-- --------------------------------------------------- structure and hardening

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'saved_churches', 'saved_churches table exists');
select has_table('public', 'stripe_customers', 'stripe_customers table exists');
select has_table('public', 'subscriptions', 'subscriptions table exists');
select has_table('public', 'stripe_events', 'stripe_events table exists');

select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('profiles', 'saved_churches', 'stripe_customers',
                        'subscriptions', 'stripe_events')
      and c.relrowsecurity
  ),
  5,
  'row level security is enabled on all five tables'
);

select is_empty(
  $$ select table_name::text
     from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public'
       and table_name in ('profiles', 'saved_churches', 'stripe_customers',
                          'subscriptions', 'stripe_events') $$,
  'the anon role holds no privileges on any application table'
);

-- Supabase grants the API roles blanket DML on new public tables, so pin the
-- surviving privileges exactly: anything unexpected here means a revoke was
-- missed and RLS is the only thing standing in the way.
select is(
  (select string_agg(t || ':' || p, ' ' order by t, p)
   from unnest(array['profiles', 'saved_churches', 'stripe_customers',
                     'subscriptions', 'stripe_events']) t
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege('authenticated', 'public.' || t, p)),
  'profiles:SELECT saved_churches:DELETE saved_churches:INSERT '
  || 'saved_churches:SELECT stripe_customers:SELECT subscriptions:SELECT',
  'the authenticated role holds only the table privileges the app needs'
);

select is(
  (select string_agg(c, ',' order by c)
   from unnest(array['id', 'email', 'display_name', 'created_at', 'updated_at']) c
   where has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE')),
  'display_name',
  'display_name is the only profile column a user may write'
);

-- The webhook ledger is service-role-only: RLS is on and no policy grants
-- anything, so even a correctly authenticated user sees nothing.
select is_empty(
  $$ select policyname::text from pg_policies
     where schemaname = 'public' and tablename = 'stripe_events' $$,
  'stripe_events has no policies, so RLS denies every API role'
);

-- ------------------------------------------------------- profiles population

select is(
  (select count(*)::int from public.profiles),
  2,
  'the auth.users trigger created a profile per user'
);

select is(
  (select email from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'alice@example.test',
  'the profile trigger copied the email across'
);

update auth.users set email = 'alice+new@example.test'
  where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select email from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'alice+new@example.test',
  'the profile trigger follows an email change'
);

select is_empty(
  $$ select 1 from public.stripe_customers $$,
  'signing up on its own creates nothing in Stripe'
);

-- ------------------------------------------------------------- as anonymous

reset role;
set local request.jwt.claims = '{"role":"anon"}';
set local role anon;

select throws_ok(
  $$ select * from public.profiles $$,
  '42501'::text, null::text,
  'anon cannot read profiles at all (privilege, not just policy)'
);

select throws_ok(
  $$ select * from public.saved_churches $$,
  '42501'::text, null::text,
  'anon cannot read saved parishes'
);

select throws_ok(
  $$ select * from public.subscriptions $$,
  '42501'::text, null::text,
  'anon cannot read subscriptions'
);

-- ------------------------------------------- as Alice, before starting a trial

reset role;
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.profiles),
  1,
  'a signed-in user sees exactly one profile row'
);

select is(
  (select id from public.profiles),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'and it is their own'
);

select is(
  public.has_access(),
  false,
  'signing in alone does not grant access — the trial lives in Stripe'
);

select throws_ok(
  $$ insert into public.saved_churches (user_id, church_slug)
     values ('11111111-1111-1111-1111-111111111111', 'st-marys-corning') $$,
  '42501'::text, null::text,
  'and nothing can be saved yet'
);

select lives_ok(
  $$ update public.profiles set display_name = 'Alice' $$,
  'a user can rename themselves'
);

select throws_ok(
  $$ update public.profiles set email = 'attacker@example.test' $$,
  '42501'::text, null::text,
  'a user cannot rewrite the email Stripe identifies them by'
);

select throws_ok(
  $$ insert into public.subscriptions (id, user_id, stripe_customer_id, status)
     values ('sub_forged', '11111111-1111-1111-1111-111111111111', 'cus_forged', 'active') $$,
  '42501'::text, null::text,
  'a user cannot grant themselves a subscription'
);

select throws_ok(
  $$ select * from public.stripe_events $$,
  '42501'::text, null::text,
  'a user cannot read the webhook ledger'
);

-- ---------------------------------------------- the card-free trial in Stripe

reset role;
insert into public.stripe_customers (user_id, stripe_customer_id)
  values ('11111111-1111-1111-1111-111111111111', 'cus_alice');
insert into public.subscriptions
  (id, user_id, stripe_customer_id, status, trial_end)
  values ('sub_alice', '11111111-1111-1111-1111-111111111111', 'cus_alice',
          'trialing', now() + interval '7 days');
set local role authenticated;

select is(public.has_access(), true, 'a Stripe trial grants access');

select lives_ok(
  $$ insert into public.saved_churches (user_id, church_slug)
     values ('11111111-1111-1111-1111-111111111111', 'st-marys-corning'),
            ('11111111-1111-1111-1111-111111111111', 'all-saints') $$,
  'and a trialling user can save parishes'
);

select throws_ok(
  $$ insert into public.saved_churches (user_id, church_slug)
     values ('22222222-2222-2222-2222-222222222222', 'all-saints') $$,
  '42501'::text, null::text,
  'a user cannot save a parish into someone else''s account'
);

select throws_ok(
  $$ insert into public.saved_churches (user_id, church_slug)
     values ('11111111-1111-1111-1111-111111111111', 'Not A Slug!') $$,
  '23514'::text, null::text,
  'the slug format check rejects anything that is not a parish slug'
);

select results_eq(
  $$ select has_access, saved_count from public.account_entitlements() $$,
  $$ values (true, 2) $$,
  'account_entitlements reports access during the trial'
);

-- ------------------------- the trial ends with no card: Stripe pauses it

reset role;
update public.subscriptions set status = 'paused', trial_end = now() - interval '1 day'
  where id = 'sub_alice';
set local role authenticated;

select is(public.has_access(), false, 'a paused subscription does not grant access');

select throws_ok(
  $$ insert into public.saved_churches (user_id, church_slug)
     values ('11111111-1111-1111-1111-111111111111', 'holy-cross-freeville') $$,
  '42501'::text, null::text,
  'saving is refused by the database once the trial has run out'
);

select is(
  (select count(*)::int from public.saved_churches),
  2,
  'but what was already saved is still readable'
);

-- ----------------- a card is added and the resume attempt fails: still locked

reset role;
update public.subscriptions set status = 'past_due' where id = 'sub_alice';
set local role authenticated;

select is(
  public.has_access(),
  false,
  'past_due on a subscription that never paid does not buy access'
);

-- --------------------------------- the payment succeeds and the account is live

reset role;
update public.subscriptions set status = 'active', first_paid_at = now()
  where id = 'sub_alice';
set local role authenticated;

select is(public.has_access(), true, 'a paid subscription grants access');

select lives_ok(
  $$ insert into public.saved_churches (user_id, church_slug)
     values ('11111111-1111-1111-1111-111111111111', 'holy-cross-freeville') $$,
  'and saving works again'
);

-- ------------------- a later renewal fails: the dunning grace period applies

reset role;
update public.subscriptions set status = 'past_due' where id = 'sub_alice';
set local role authenticated;

select is(
  public.has_access(),
  true,
  'past_due keeps access once the subscription has paid at least once'
);

reset role;
update public.subscriptions set status = 'canceled' where id = 'sub_alice';
set local role authenticated;

select is(public.has_access(), false, 'a cancelled subscription does not');

select is(
  (select count(*)::int from public.subscriptions),
  1,
  'a user can read their own subscription'
);

select is(
  (select count(*)::int from public.stripe_customers),
  1,
  'a user can read their own Stripe customer mapping'
);

-- ------------------------------------------------------------------ as Bob

reset role;
set local request.jwt.claims =
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
set local role authenticated;

select is(
  (select count(*)::int from public.saved_churches),
  0,
  'another user sees none of the first user''s saved parishes'
);

select is(
  (select count(*)::int from public.subscriptions),
  0,
  'nor their subscription'
);

select is(public.has_access(), false, 'and is not entitled by it');

with removed as (
  delete from public.saved_churches
  where user_id = '11111111-1111-1111-1111-111111111111'
  returning 1
)
select is(
  count(*)::int,
  0,
  'a delete aimed at another user''s rows removes nothing'
) from removed;

-- --------------------------------------------------- ownership of own rows

reset role;
set local request.jwt.claims =
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

with removed as (
  delete from public.saved_churches
  where church_slug = 'holy-cross-freeville'
  returning 1
)
select is(
  count(*)::int,
  1,
  'a user can unsave their own parish even after their subscription ends'
) from removed;

-- ------------------------------------------------------------ account teardown

reset role;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*)::int from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'deleting the auth user cascades to their profile'
);

select is(
  (select count(*)::int from public.saved_churches
   where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'and to their saved parishes'
);

select is(
  (select count(*)::int from public.subscriptions
   where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'and to their subscription rows'
);

select * from finish();
rollback;
