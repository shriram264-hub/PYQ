-- Run in the Supabase SQL editor (as postgres). Creates nothing permanent.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'rls-a@example.test'),
  ('00000000-0000-0000-0000-0000000000bb', 'rls-b@example.test');

-- Signed-out visitors (anon) can reach none of the tables.
set local role anon;
do $$ begin
  perform 1 from public.question_progress;
  raise exception 'FAIL: anon can read question_progress';
exception when insufficient_privilege then null; end $$;
reset role;

-- User A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

insert into public.question_progress (user_id, question_key, status)
values ('00000000-0000-0000-0000-0000000000aa', 'upsc-2019-7', 'done');
insert into public.bookmark_sets (id, user_id, name)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000aa', 'Polity');
insert into public.bookmarks (set_id, user_id, question_key)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000aa', 'upsc-2019-7');

do $$ begin
  insert into public.question_progress (user_id, question_key, status)
  values ('00000000-0000-0000-0000-0000000000bb', 'upsc-2019-8', 'done');
  raise exception 'FAIL: A wrote a progress row owned by B';
exception when insufficient_privilege then null; end $$;

do $$ begin
  insert into public.entitlements (user_id, plan, valid_until, source)
  values ('00000000-0000-0000-0000-0000000000aa', 'pass', now() + interval '1 year', 'test');
  raise exception 'FAIL: a user wrote entitlements';
exception when insufficient_privilege then null; end $$;

-- User B
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

do $$ declare n int; begin
  select count(*) into n from public.question_progress;
  if n <> 0 then raise exception 'FAIL: B can see % progress rows of A', n; end if;
  select count(*) into n from public.bookmark_sets;
  if n <> 0 then raise exception 'FAIL: B can see A''s lists'; end if;
  select count(*) into n from public.bookmarks;
  if n <> 0 then raise exception 'FAIL: B can see A''s bookmarks'; end if;

  update public.question_progress set status = 'review';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A''s progress'; end if;

  delete from public.question_progress;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A''s progress'; end if;

  delete from public.bookmark_sets;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A''s list'; end if;
end $$;

do $$ begin
  insert into public.bookmarks (set_id, user_id, question_key)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000bb', 'upsc-2019-9');
  raise exception 'FAIL: B added to A''s list';
exception when insufficient_privilege then null; end $$;

do $$ begin
  insert into public.bookmarks (set_id, user_id, question_key)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000aa', 'upsc-2019-9');
  raise exception 'FAIL: B wrote a bookmark as A';
exception when insufficient_privilege then null; end $$;

select 'All RLS checks passed' as result;
rollback;
