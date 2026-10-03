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
The privacy policy promises a **reply within 30 days** of the email
(`LEGAL.replyDays` in `site/src/lib/legal.js`), and that a deletion request
removes the account, its marks and lists, and the sign-in records we can
remove. Do the steps below before that reply. There is no self-serve delete;
do it by hand.

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
   step 2. In the **SQL Editor**, with the UID from step 2:
   1. Find every row that mentions them. Search the whole payload, not one key:
      a sign-in carries the id under `actor_id`, but an admin event such as
      "user deleted" (step 2 writes one) may carry it under `traits` instead.
      ```sql
      select id, created_at, payload from auth.audit_log_entries
      where payload::text like '%<user id>%'
      order by created_at;
      ```
      Read what comes back and check every row is about this student.
   2. **If it returns no rows**, there is nothing to purge: skip the delete,
      and note it for your reply (audit logging may be off on the project, or
      the rows may have expired already).
   3. Otherwise delete exactly those rows, with the same condition:
      ```sql
      delete from auth.audit_log_entries where payload::text like '%<user id>%';
      ```
      Expect the number of rows deleted to equal the number step 3.1 showed.
4. **Reply to the student** to confirm the account, marks, lists and sign-in
   records are deleted (or that no sign-in records were held, from step 3.2).
   Render's logs and Supabase's own request logs are not deleted here; they
   expire on the services' own schedule, as the privacy policy says.
5. **If they ask, delete their emails too.** Their messages sit in the
   hello@sawaalbox.in mailbox (Zoho Mail), which the privacy policy says we
   keep until they ask us to delete them. After sending the reply, delete the
   whole thread, including your replies, then empty it from the mailbox's
   Trash.
