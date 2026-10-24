-- Run in the Supabase SQL editor (as postgres). Creates nothing permanent.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'rls-a@example.test'),
  ('00000000-0000-0000-0000-0000000000bb', 'rls-b@example.test');

-- Passes can only be written by the service role, so seed one active pass each
-- for A and B here, as postgres, before any role is switched.
insert into public.passes (user_id, exam, mode, valid_until, payment_id, order_id, amount_paise, status)
values
  ('00000000-0000-0000-0000-0000000000aa', 'upsc', 'test', '2027-05-24', 'pay_rls_a1', 'order_rls_a1', 49900, 'active'),
  ('00000000-0000-0000-0000-0000000000bb', 'upsc', 'test', '2027-05-24', 'pay_rls_b1', 'order_rls_b1', 49900, 'active');

-- Signed-out visitors (anon) can reach none of the tables.
set local role anon;
do $$ begin
  perform 1 from public.question_progress;
  raise exception 'FAIL: anon can read question_progress';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform 1 from public.passes;
  raise exception 'FAIL: anon can read passes';
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

-- Nobody below the service role writes a pass, not even for themselves.
do $$ begin
  insert into public.passes (user_id, exam, mode, valid_until, payment_id, order_id, amount_paise, status)
  values ('00000000-0000-0000-0000-0000000000aa', 'upsc', 'live', '2027-05-24', 'pay_rls_a2', 'order_rls_a2', 49900, 'active');
  raise exception 'FAIL: a user wrote a pass';
exception when insufficient_privilege then null; end $$;

do $$ begin
  update public.passes set valid_until = '2099-01-01';
  raise exception 'FAIL: A updated a pass';
exception when insufficient_privilege then null; end $$;

do $$ begin
  delete from public.passes;
  raise exception 'FAIL: A deleted a pass';
exception when insufficient_privilege then null; end $$;

-- Positive control: A sees exactly 1 row in each table before switching to B.
do $$ declare n int; begin
  select count(*) into n from public.passes;
  if n <> 1 then raise exception 'FAIL: A should see 1 pass, saw %', n; end if;
  perform 1 from public.passes where payment_id = 'pay_rls_a1';
  if not found then raise exception 'FAIL: A does not see its own pass'; end if;
  select count(*) into n from public.question_progress;
  if n <> 1 then raise exception 'FAIL: A should see 1 progress row, saw %', n; end if;
  select count(*) into n from public.bookmark_sets;
  if n <> 1 then raise exception 'FAIL: A should see 1 set, saw %', n; end if;
  select count(*) into n from public.bookmarks;
  if n <> 1 then raise exception 'FAIL: A should see 1 bookmark, saw %', n; end if;
end $$;

-- User B
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

do $$ declare n int; begin
  -- B sees its own pass and none of A's.
  select count(*) into n from public.passes;
  if n <> 1 then raise exception 'FAIL: B should see 1 pass, saw %', n; end if;
  perform 1 from public.passes where user_id = '00000000-0000-0000-0000-0000000000aa';
  if found then raise exception 'FAIL: B can see A''s pass'; end if;

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

  update public.bookmark_sets set name = 'x';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A''s set'; end if;

  update public.bookmarks set question_key = 'upsc-2019-1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A''s bookmark'; end if;

  delete from public.bookmarks;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A''s bookmark'; end if;
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

-- B cannot insert, update or delete passes (write-protected).
do $$ begin
  insert into public.passes (user_id, exam, mode, valid_until, payment_id, order_id, amount_paise, status)
  values ('00000000-0000-0000-0000-0000000000bb', 'upsc', 'live', '2027-05-24', 'pay_rls_b2', 'order_rls_b2', 49900, 'active');
  raise exception 'FAIL: B wrote a pass';
exception when insufficient_privilege then null; end $$;

do $$ begin
  update public.passes set status = 'refunded';
  raise exception 'FAIL: B updated a pass';
exception when insufficient_privilege then null; end $$;

do $$ begin
  delete from public.passes;
  raise exception 'FAIL: B deleted a pass';
exception when insufficient_privilege then null; end $$;

-- Owner-change attempts: B inserts its own data, then tries to change owners.
insert into public.question_progress (user_id, question_key, status)
values ('00000000-0000-0000-0000-0000000000bb', 'upsc-2019-8', 'done');
insert into public.bookmark_sets (id, user_id, name)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000bb', 'B list');
insert into public.bookmarks (set_id, user_id, question_key)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000bb', 'upsc-2019-8');

do $$ begin
  update public.bookmarks set set_id = '00000000-0000-0000-0000-0000000000a1' where set_id = '00000000-0000-0000-0000-0000000000b1';
  raise exception 'FAIL: B re-pointed its bookmark into A''s set';
exception when insufficient_privilege then null; end $$;

do $$ begin
  update public.question_progress set user_id = '00000000-0000-0000-0000-0000000000aa' where user_id = '00000000-0000-0000-0000-0000000000bb';
  raise exception 'FAIL: B changed its progress owner to A';
exception when insufficient_privilege then null; end $$;

-- Mock test attempts (migration 20261011120000_test_attempts.sql).
reset role;
set local role anon;
do $$ begin
  perform 1 from public.test_attempts;
  raise exception 'FAIL: anon can read test_attempts';
exception when insufficient_privilege then null; end $$;
reset role;
set local role authenticated;

-- A writes an attempt.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
insert into public.test_attempts (id, user_id, exam, kind, spec, question_keys, answers, review_keys,
  current_index, limit_ms, elapsed_ms, status, started_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-0000-0000-0000000000aa', 'upsc', 'paper',
  '{"year":2019}', array['upsc-2019-1','upsc-2019-2'], '{"upsc-2019-1":"a"}', array[]::text[],
  0, 7200000, 1000, 'in_progress', now(), now());

do $$ declare n int; begin
  select count(*) into n from public.test_attempts;
  if n <> 1 then raise exception 'FAIL: A should see 1 attempt, saw %', n; end if;
  update public.test_attempts set elapsed_ms = 2000;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not update its own attempt'; end if;
end $$;

-- Nobody deletes an attempt, not even its owner.
do $$ begin
  delete from public.test_attempts;
  raise exception 'FAIL: A deleted an attempt';
exception when insufficient_privilege then null; end $$;

-- B cannot see, change, take over or delete it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.test_attempts;
  if n <> 0 then raise exception 'FAIL: B can see % of A''s attempts', n; end if;
  update public.test_attempts set status = 'abandoned';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A''s attempt'; end if;
end $$;

do $$ begin
  delete from public.test_attempts;
  raise exception 'FAIL: B deleted an attempt';
exception when insufficient_privilege then null; end $$;

do $$ begin
  insert into public.test_attempts (id, user_id, exam, kind, spec, question_keys, answers, review_keys,
    current_index, limit_ms, elapsed_ms, status, started_at, updated_at)
  values ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-0000-0000-0000000000aa', 'upsc', 'paper',
    '{"year":2019}', array['upsc-2019-1'], '{}', array[]::text[], 0, 7200000, 0, 'in_progress', now(), now());
  raise exception 'FAIL: B wrote an attempt as A';
exception when insufficient_privilege then null; end $$;

-- B's own attempt, which B then tries to hand to A.
insert into public.test_attempts (id, user_id, exam, kind, spec, question_keys, answers, review_keys,
  current_index, limit_ms, elapsed_ms, status, started_at, updated_at)
values ('00000000-0000-4000-8000-0000000000b8', '00000000-0000-0000-0000-0000000000bb', 'upsc', 'paper',
  '{"year":2020}', array['upsc-2020-1'], '{}', array[]::text[], 0, 7200000, 0, 'in_progress', now(), now());

do $$ begin
  update public.test_attempts set user_id = '00000000-0000-0000-0000-0000000000aa'
  where id = '00000000-0000-4000-8000-0000000000b8';
  raise exception 'FAIL: B changed its attempt''s owner to A';
exception when insufficient_privilege then null; end $$;

-- An upsert onto A's id is refused, as the sync's upsert would be.
do $$ begin
  insert into public.test_attempts (id, user_id, exam, kind, spec, question_keys, answers, review_keys,
    current_index, limit_ms, elapsed_ms, status, started_at, updated_at)
  values ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-0000-0000-0000000000bb', 'upsc', 'paper',
    '{"year":2019}', array['upsc-2019-1'], '{}', array[]::text[], 0, 7200000, 0, 'in_progress', now(), now())
  on conflict (id) do update set status = excluded.status;
  raise exception 'FAIL: B upserted over A''s attempt';
exception when insufficient_privilege then null; end $$;

-- The database refuses a second active pass for the same user, exam and mode
-- (passes_one_active). Run as postgres so this tests the index, not row-level
-- security. A different payment_id and order_id mean only the index can object,
-- and the handler checks which constraint fired.
reset role;
do $$ declare c text; begin
  insert into public.passes (user_id, exam, mode, valid_until, payment_id, order_id, amount_paise, status)
  values ('00000000-0000-0000-0000-0000000000aa', 'upsc', 'test', '2027-05-24', 'pay_rls_a3', 'order_rls_a3', 49900, 'active');
  raise exception 'FAIL: a second active pass for the same user, exam and mode was accepted';
exception when unique_violation then
  get stacked diagnostics c = constraint_name;
  if c is distinct from 'passes_one_active' then
    raise exception 'FAIL: second active pass refused by %, not passes_one_active', c;
  end if;
end $$;

-- Positive controls for the index: it is partial and keyed on mode and exam,
-- so a refunded row, a live-mode pass and another exam's pass are all allowed.
-- Without these, an index that refused everything would pass the check above.
do $$ declare n int; begin
  insert into public.passes (user_id, exam, mode, valid_until, payment_id, order_id, amount_paise, status, note, refunded_at)
  values ('00000000-0000-0000-0000-0000000000aa', 'upsc', 'test', '2027-05-24', 'pay_rls_a4', 'order_rls_a4', 49900, 'refunded', 'duplicate', now());
  insert into public.passes (user_id, exam, mode, valid_until, payment_id, order_id, amount_paise, status)
  values ('00000000-0000-0000-0000-0000000000aa', 'upsc', 'live', '2027-05-24', 'pay_rls_a5', 'order_rls_a5', 49900, 'active');
  insert into public.passes (user_id, exam, mode, valid_until, payment_id, order_id, amount_paise, status)
  values ('00000000-0000-0000-0000-0000000000aa', 'ssc', 'test', '2027-05-24', 'pay_rls_a6', 'order_rls_a6', 49900, 'active');
  select count(*) into n from public.passes where user_id = '00000000-0000-0000-0000-0000000000aa';
  if n <> 4 then raise exception 'FAIL: expected 4 passes for A after controls, saw %', n; end if;
end $$;

-- The same payment can only be recorded once.
do $$ begin
  insert into public.passes (user_id, exam, mode, valid_until, payment_id, order_id, amount_paise, status)
  values ('00000000-0000-0000-0000-0000000000bb', 'ssc', 'test', '2027-05-24', 'pay_rls_a1', 'order_rls_b9', 49900, 'active');
  raise exception 'FAIL: a payment_id was recorded twice';
exception when unique_violation then null; end $$;

select 'All RLS checks passed' as result;
rollback;
