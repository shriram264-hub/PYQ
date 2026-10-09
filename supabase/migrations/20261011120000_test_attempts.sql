-- Mock tests: one row per attempt. The id is made on the device that started
-- it, so the same attempt is the same row from every device. Rows are never
-- deleted: there is no delete grant, and an abandoned attempt is a status.

create table public.test_attempts (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  exam          text not null,
  kind          text not null check (kind in ('paper', 'custom')),
  spec          jsonb not null,
  question_keys text[] not null check (cardinality(question_keys) between 1 and 150),
  answers       jsonb not null,
  review_keys   text[] not null,
  current_index int not null,
  limit_ms      int not null,
  elapsed_ms    int not null check (elapsed_ms >= 0),
  status        text not null check (status in ('in_progress', 'submitted', 'abandoned')),
  started_at    timestamptz not null,
  updated_at    timestamptz not null,
  submitted_at  timestamptz,
  result        jsonb
);
create index test_attempts_user_id_idx on public.test_attempts (user_id);

alter table public.test_attempts enable row level security;

-- As for the accounts tables: nothing reachable until granted, signed-out
-- visitors get nothing, and signed-in users may read, add and change their own
-- rows, never delete them.
revoke all on public.test_attempts from anon, authenticated;
grant select, insert, update on public.test_attempts to authenticated;

create policy test_attempts_select_own on public.test_attempts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy test_attempts_insert_own on public.test_attempts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy test_attempts_update_own on public.test_attempts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
