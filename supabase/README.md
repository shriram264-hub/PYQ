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

## Deleting a student's account on request
The privacy policy promises this within 30 days of the email. There is no
self-serve delete; do it by hand.

1. **Check the request is theirs.** It must come from the email address of the
   account. If it does not, reply asking them to write from that address.
2. **Delete the user.** Supabase dashboard → **Authentication** → **Users** →
   search for the email → open the user → copy the **User UID** (you need it in
   step 3) → **Delete user**. Every table that holds their data
   (`question_progress`, `bookmark_sets`, `bookmarks`, `entitlements`)
   references `auth.users` with `on delete cascade`, so their marks and lists go
   with it.
3. **Remove their sign-in records.** Supabase's audit log
   (`auth.audit_log_entries`) has no foreign key to `auth.users`, so it outlives
   step 2. In the **SQL Editor**:
   1. Look at one row first and **check the key names**; the query below
      assumes the user's id is under `actor_id`, which may not hold for every
      Supabase version:
      ```sql
      select payload from auth.audit_log_entries order by created_at desc limit 1;
      ```
   2. Count what will go, using the key you confirmed and the UID from step 2:
      ```sql
      select count(*) from auth.audit_log_entries where payload->>'actor_id' = '<user id>';
      ```
   3. If the count looks right, delete:
      ```sql
      delete from auth.audit_log_entries where payload->>'actor_id' = '<user id>';
      ```
4. **Reply to the student** to confirm the account, marks, lists and sign-in
   records are deleted. Render's logs and Supabase's own request logs are not
   deleted here; they expire on the services' own schedule, as the privacy
   policy says.
