-- Paid passes: one row per payment. A row is written only by the payments
-- function, with the service role, after Razorpay has confirmed the payment;
-- no signed-in user or visitor can add, change or delete one. The row is a
-- financial record, so it is kept when the account is deleted: user_id is set
-- to null instead of the row cascading away.

-- Replaced by passes. It was empty and nothing read or wrote it.
drop table public.entitlements;

create table public.passes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users on delete set null,
  exam         text not null check (exam ~ '^[a-z]+$'),
  mode         text not null check (mode in ('test', 'live')),
  valid_until  date not null,
  payment_id   text not null unique,
  order_id     text not null,
  amount_paise int not null check (amount_paise > 0),
  status       text not null check (status in ('active', 'refunded')),
  note         text,
  created_at   timestamptz not null default now(),
  refunded_at  timestamptz
);

-- The database itself refuses a second active pass for the same user, exam and
-- mode, so two payments racing each other cannot both switch a pass on. A
-- refunded row does not count, and rows detached from a deleted account
-- (user_id null) never clash.
create unique index passes_one_active on public.passes (user_id, exam, mode)
  where status = 'active';

alter table public.passes enable row level security;

-- Nothing reachable until granted, signed-out visitors get nothing, and
-- signed-in users may only read their own passes. No role below the service
-- role can write: there is no insert, update or delete grant or policy.
revoke all on public.passes from anon, authenticated;
grant select on public.passes to authenticated;

create policy passes_select_own on public.passes
  for select to authenticated
  using (user_id = (select auth.uid()));
