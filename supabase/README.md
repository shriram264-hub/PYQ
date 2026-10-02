# Supabase

Schema changes live in `migrations/` and are applied in order. `tests/` holds
checks that run inside a transaction and roll back, so they leave no data.

## Apply a migration
1. Supabase dashboard → your project → **SQL Editor** → **New query**.
2. Paste the whole migration file, click **Run**. Expect "Success. No rows returned".

## Run the row-level security test
1. SQL Editor → New query → paste `tests/rls_test.sql` → **Run**.
2. Expect one row: `All RLS checks passed`. Any `FAIL:` message is a security bug: stop and report it.

Never put the `service_role` / secret key or the database password in this repo.
