-- Accounts part 1: progress marks, revision lists, and (read-only) entitlements.
-- Every row belongs to one user; row-level security is the only boundary.

create table public.question_progress (
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  question_key text not null check (question_key ~ '^[a-z]+-[0-9]{4}-[0-9]{1,3}$'),
  status       text not null check (status in ('done', 'review')),
  updated_at   timestamptz not null default now(),
  primary key (user_id, question_key)
);

create table public.bookmark_sets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index bookmark_sets_user_id_idx on public.bookmark_sets (user_id);

-- user_id duplicates what set_id implies, so the policy is one equality check.
create table public.bookmarks (
  set_id       uuid not null references public.bookmark_sets on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  question_key text not null check (question_key ~ '^[a-z]+-[0-9]{4}-[0-9]{1,3}$'),
  added_at     timestamptz not null default now(),
  primary key (set_id, question_key)
);
create index bookmarks_user_id_idx on public.bookmarks (user_id);

-- Written only server-side, after a verified payment (part 3).
create table public.entitlements (
  user_id     uuid primary key references auth.users on delete cascade,
  plan        text not null,
  valid_until timestamptz not null,
  source      text not null,
  created_at  timestamptz not null default now()
);

alter table public.question_progress enable row level security;
alter table public.bookmark_sets     enable row level security;
alter table public.bookmarks         enable row level security;
alter table public.entitlements      enable row level security;

-- "Automatically expose new tables" is off for this project: nothing is
-- reachable through the Data API until granted here. Signed-out visitors
-- (anon) get nothing.
revoke all on public.question_progress, public.bookmark_sets, public.bookmarks, public.entitlements from anon, authenticated;
grant select, insert, update, delete on public.question_progress, public.bookmark_sets, public.bookmarks to authenticated;
grant select on public.entitlements to authenticated;

create policy question_progress_owner on public.question_progress
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy bookmark_sets_owner on public.bookmark_sets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A bookmark can only go into a set the same user owns, so nobody can add to
-- someone else's list by guessing its id.
create policy bookmarks_owner on public.bookmarks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.bookmark_sets s
      where s.id = set_id and s.user_id = (select auth.uid())
    )
  );

create policy entitlements_read_own on public.entitlements
  for select to authenticated
  using (user_id = (select auth.uid()));
