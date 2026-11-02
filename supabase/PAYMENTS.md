# Payments: the owner's guide

How to set up, test, switch on and run the paid **UPSC Prelims pass** (₹499,
valid until 24 May 2027). It is written to be followed step by step in the
Supabase, Razorpay and Render dashboards. You never need a terminal.

## Before you start

**Three Razorpay values are involved:**

| Name | What it is | Secret? |
|---|---|---|
| Key Id | Starts `rzp_test_` (test mode) or `rzp_live_` (live mode). | No, it is public. |
| Key Secret | Shown once, next to the Key Id, when you generate API keys. | **Yes.** |
| Webhook Secret | A long random password you make up yourself (section 4). | **Yes.** |

**Rules for the two secrets:**
- Apart from the keys file you download and keep privately, they go in
  exactly two places: the Razorpay dashboard and Supabase's Edge Function
  Secrets page.
- **Never paste a secret into chat** (Claude doesn't need it, and must never
  see it), into an email, into the repo, or into Render.
- If the **Key Secret** leaks: generate a new key in Razorpay (**Account &
  Settings** → **API Keys**) and replace `RAZORPAY_KEY_SECRET` (and
  `RAZORPAY_KEY_ID`, if it changed) in Supabase. **Never paste this secret into
  chat.**
- If the **Webhook Secret** leaks: Razorpay doesn't generate this one. Make up
  a new one yourself, set it in the Razorpay webhook's edit form (the webhook →
  **Edit** → Secret → **Save Webhook**), and set the same value as
  `RAZORPAY_WEBHOOK_SECRET` in Supabase. **Never paste this secret into chat.**

**The order of work:**
- **Now, in test mode:** sections 1 to 5. Nothing changes for students:
  payments stay switched off on the live site.
- **After Razorpay approves your account:**
  1. section 7, part A (live keys and live webhook);
  2. then section 6 (the 7-day notice, which also puts the Buy button on /plans);
  3. then section 7, part B (one real ₹499 purchase and refund).
- **Any time after that:** sections 8 to 10.

**Menu names.** They were checked against Supabase's, Razorpay's and Render's
docs in October 2026. Dashboards change, so if a label differs slightly, look
for the nearest match. Razorpay's own docs spell its settings menu both
"Account & Settings" and "Accounts & Settings"; it is the same menu.

**Names used below.** The Supabase project is `fcmwzpokqufvkojcqaxo`. The
function is called `payments`. It has three addresses:

| Address | Called by |
|---|---|
| `https://fcmwzpokqufvkojcqaxo.supabase.co/functions/v1/payments/create-order` | the /plans page, when Buy is pressed |
| `https://fcmwzpokqufvkojcqaxo.supabase.co/functions/v1/payments/confirm` | the /plans page, after Checkout succeeds |
| `https://fcmwzpokqufvkojcqaxo.supabase.co/functions/v1/payments/webhook` | Razorpay |

---

## 1. Apply the passes migration and run the RLS test

1. Supabase dashboard → your project → **SQL Editor** → **New query**.
2. Ask Claude to copy `supabase/migrations/20261024120000_passes.sql` to your
   clipboard. Paste it into the query, then click **Run**.
3. **Expect** "Success. No rows returned".
   - If it says `entitlements is not empty: refusing to drop it`, nothing was
     changed. Stop and tell Claude.
4. **New query** again. Ask Claude to copy `supabase/tests/rls_test.sql`, then
   paste it and click **Run**.
5. **Expect** one row: `All RLS checks passed`.
   - Any `FAIL:` message is a security bug. Stop and tell Claude.

The test runs inside a transaction and rolls back, so it leaves no data behind.

## 2. Deploy the function

1. Supabase dashboard → left sidebar → **Edge Functions**.
2. Click **Deploy a new function**, then **Via Editor**.
3. The editor opens with a template in a file called `index.ts`.
   1. Ask Claude to copy `supabase/functions/payments/index.js` to your
      clipboard.
   2. Click inside the editor and select everything (Ctrl+A).
   3. Paste (Ctrl+V), so the whole template is replaced by the whole file.

   The file is plain JavaScript written to work as `index.ts`. Do not change
   anything in it.
4. Where the editor asks for the function's name, type exactly `payments`.
   - Not the template's name (such as `hello-world`): the site calls
     `/functions/v1/payments`.
5. Click **Deploy function**. It takes 10–30 seconds.
6. **Turn JWT verification off for this function.**
   1. On the function's page, look through its tabs (the settings are usually
      under the details or configuration tab) for the switch about **JWT
      verification**. Supabase has labelled it "Verify JWT" or "Enforce JWT
      verification" at different times.
   2. Turn the switch **off** and save.

   **Why:** with it on, Supabase turns away any call that does not carry a
   Supabase sign-in token. Razorpay's webhook calls never carry one, so the
   pass would never switch on from the webhook. The function does its own
   checking:
   - `create-order` and `confirm` check the student's sign-in themselves;
   - `webhook` checks Razorpay's signature.
7. **Check it** by opening this address in your browser:
   `https://fcmwzpokqufvkojcqaxo.supabase.co/functions/v1/payments/webhook`
   - **Expect** `{"error":"method_not_allowed"}`. This is right: a browser asks
     with GET, and the webhook only accepts Razorpay's POST. It proves the
     function is running and JWT verification is off.
   - If you see a message about a missing **authorization** header or an
     invalid **JWT**, step 6 didn't take. Go back to it.
   - If you see "not found" or a 404 from Supabase, check the name in step 4.

**When Claude later changes `index.js`:**
1. Open the function, then its code.
2. Select all, and paste the new file.
3. Click **Deploy updates**.

The dashboard keeps no old versions, so keep the repo's copy as the master.

## 3. Secrets (test values first)

**First, check the Supabase keys. You copy nothing here.**
- Supabase gives every function its own address and keys automatically
  (`SUPABASE_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`, and
  the older `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`). You set none of
  them, and must never copy a Supabase key anywhere.
- One thing to check: dashboard → **Project Settings** → **API Keys**. Under
  **Secret keys** there should be a key named **default**.
  - The function uses it to write passes.
  - Without it, the function falls back to the older `service_role` key,
    which Supabase is retiring by the end of 2026.
  - If no secret key is listed, create one on that page and tell Claude. Do
    not copy it.

**Get the Razorpay test keys:**
1. Razorpay dashboard → switch the mode at the top to **Test**.
2. **Account & Settings** → **API Keys** (under "Website and app settings") →
   **Generate Key**.
3. Download the keys file and keep it somewhere private. Razorpay shows the
   Key Secret only now; later only the Key Id is visible. If you lose it, use
   **Generate new key** and repeat this section.

**Put them into Supabase:**
1. Supabase dashboard → **Edge Functions** → **Secrets**. The page is titled
   **Edge Function Secrets**.
2. In **Add new secrets**, enter these as **Key** and **Value**, using
   **Add another** for each extra row:

   | Key (type exactly) | Value |
   |---|---|
   | `RAZORPAY_KEY_ID` | the test Key Id (starts `rzp_test_`) |
   | `RAZORPAY_KEY_SECRET` | the test Key Secret. **Never paste this secret into chat.** |
   | `RAZORPAY_WEBHOOK_SECRET` | leave this one until section 4, step 5 |

3. Click **Save**.

**What to expect:**
- The function reads new secrets at once; no redeploy is needed.
- The page lists the names, never the values in full.
- Names starting with `SUPABASE_` are refused; they are Supabase's own.

## 4. Razorpay webhook (test mode)

This is how Razorpay tells the function about a payment even when the student's
page closed too early, and about refunds.

1. Razorpay dashboard, still in **Test** mode → **Accounts & Settings** →
   **Webhooks** (under "Website and app settings") → **+ Add New Webhook**.
   - In test mode Razorpay may ask for an OTP here. Its documented test-mode
     OTP is `754081`.
2. **URL**: `https://fcmwzpokqufvkojcqaxo.supabase.co/functions/v1/payments/webhook`
3. **Secret**: make up a long random password yourself.
   - At least 32 letters and digits, from a password manager's generator.
   - Not your Key Secret.
   - **Never paste this secret into chat.**
4. **Alert Email**: your email address. Razorpay writes here if deliveries
   keep failing.
5. Before saving, put the same secret into Supabase:
   1. **Edge Functions** → **Secrets** → **Add new secrets**.
   2. Key `RAZORPAY_WEBHOOK_SECRET`, Value: the same secret.
   3. **Save**.
6. Back in Razorpay, under **Active Events**, tick exactly these three:
   - `payment.authorized`
   - `payment.captured`
   - `refund.created`
7. Click **Create Webhook**. **Expect** it in the webhooks list, enabled.

**Keep automatic capture on.** Razorpay dashboard → **Account & Settings** →
scroll to **Payments Capture** → next to **Automatic Capture**, click
**Change** if it isn't already on. Keep the window it offers ("Capture all
payments authorised within") at its longest. Check it in both Test and Live mode.

**Why:** with automatic capture on, Razorpay completes every payment itself,
so a payment never sits half-finished; a payment left uncaptured is returned
to the student after a few days. The function also completes ("captures") any
payment it is told about through `payment.authorized`, so this is a second
line of safety, not the only one.

**Why these events:**
- `payment.authorized` and `payment.captured` switch the pass on. The function
  fetches the payment from Razorpay itself and checks the amount, the order and
  the account, so both events arriving is fine: still one pass.
- `refund.created` switches the pass off.

## 5. The test-mode run (with Claude)

Claude (the builder) runs the site on a local test build: test Key Id, the
paywall date in the past, test mode allowed. It drives the pages. You:
- sign in with Google when asked;
- watch the Razorpay dashboard in **Test** mode, under **Transactions** →
  **Payments**, and under **Accounts & Settings** → **Webhooks**;
- issue refunds when asked.

No real money moves: Claude fills in Razorpay's test payment details.

A new purchase needs no active pass on the account, so Claude runs the checks
in a workable order and asks you to refund the test pass between some of them.
The checks:

1. **Buy, and the pass switches on.**
   - **You see:** on /plans, "Payment received. Switching on your pass…", then
     "Your pass is active until 24 May 2027".
   - **Confirm:** Transactions → Payments shows a ₹499 payment, status
     Captured.
2. **Reload on another device, and the pass shows.**
   - **You see:** in a second browser, signed in to the same Google account,
     /plans shows the pass as active, and tests are unlocked.
3. **Drop the confirmation, and the webhook switches it on.**
   - Claude blocks the page's confirm call.
   - **You see:** "If you were charged, your pass will switch on within a few
     minutes. If it hasn't after an hour, email hello@sawaalbox.in."
   - Within minutes, a reload shows the pass active.
   - **Confirm:** the payment is Captured, and the webhook's delivery log shows
     `payment.authorized` / `payment.captured` delivered successfully.
4. **Refund in the dashboard, and the pass switches off.**
   - **You do:** Transactions → Payments → the payment → refund the full amount
     (section 8, step 5).
   - **You see:** within minutes, /plans offers Buy again.
   - **Confirm:** the payment shows Refunded, and the delivery log shows
     `refund.created` delivered.
5. **Pay twice, and there is one pass.**
   - Claude opens /plans in two tabs and pays in both.
   - **You see:** one active pass.
   - **Confirm:** two payments. The second turns Refunded on its own, with no
     action from you.
6. **Try to start a third taster test, and see the Upgrade prompt.**
   - With no pass, after one full paper and one practice set, starting another
     shows the inline Upgrade prompt (₹499, until 24 May 2027, **See the
     pass**).
7. **Buy from the prompt, and land back unlocked.**
   - **You see:** **See the pass** leads to /plans. After paying, you return to
     the test page you came from, and Start works.

To see the passes behind any check, in the **SQL Editor**:

```sql
select status, note, mode, created_at, refunded_at, payment_id
from passes order by created_at desc limit 10;
```

Every row from this run has mode `test`. Test passes never unlock anything on
the live site.

## 6. Giving 7 days' notice

**Before you start:** Razorpay has approved your account, and you have done
section 7, part A. From this step on, /plans on the live site shows the Buy
button and takes real payments.

1. **Ask Claude to update the policies' "Last updated" date (`LEGAL.updated`)
   and publish it together with the switch change.**
   - Turning on the notice changes the wording of the Terms, Pricing, Refunds,
     Delivery and Privacy pages, and they promise a new date when that happens.
   - Claude will tell you when to do step 4.
2. **Choose the paywall date.**
   - It must be **at least 7 days after the day the notice goes up**.
   - The paywall starts at 00:00 India time on that date. Until then
     everything stays free.
3. Render dashboard → the static site **upsc-pyq-search** → **Environment** →
   **+ Add Environment Variable**. Add two:

   | Key | Value |
   |---|---|
   | `PUBLIC_PAYMENTS_FROM` | the date, as `YYYY-MM-DD` (for example `2026-12-01`) |
   | `PUBLIC_RAZORPAY_KEY_ID` | the **live** Key Id, starting `rzp_live_`. Public, not a secret. |

   **Never** add `PUBLIC_PAYMENTS_ALLOW_TEST` in Render. It is for Claude's
   local test builds only.
4. Save with **Save, rebuild, and deploy**. If Claude says it will publish
   right after, **Save only** is enough, because Claude's publish rebuilds
   with these settings.
   - Do not use **Save and deploy**: it reuses the old build, and these
     settings only take effect when the site is built.
5. **Expect, once the deploy finishes:**
   - /upsc/test, the analytics page and /account show: "From [your date],
     practice tests and analytics need the UPSC Prelims pass (₹499). You'll
     still get a free taster."
   - The Terms and Pricing pages state the date.
   - The policy pages show the new "Last updated" date.
   - /plans sells the pass: **Buy for ₹499** once signed in, or **Sign in with
     Google to buy** when signed out.
6. **On the date: nothing to do.**
   - The paywall turns on by itself at 00:00 India time.
   - The notice line removes itself.
   - Optionally, Render → **Deploys** → **Manual Deploy** → **Deploy latest
     commit**, so the site is freshly built on or after the date. The pages
     already read correctly before and after the date without it.

**Buying during the notice week.** A student who buys before the paywall starts
has their 7-day refund window counted from the purchase, as always. So it may
end before the paywall starts, while everything is still free for them. Section
8's check goes by `bought_india_time`, so it needs no change, but be ready for
the question.

**To switch payments off again:** delete `PUBLIC_PAYMENTS_FROM` in Render
(Environment) and **Save, rebuild, and deploy**. Passes already bought stay in
the database.

## 7. Going live

### Part A: before the notice (after Razorpay approval)

1. Razorpay dashboard → switch the mode at the top to **Live**.
2. **Account & Settings** → **API Keys** → **Generate Key**. Download the live
   keys and keep them private.
3. Supabase → **Edge Functions** → **Secrets**. Replace the two key values with
   the live ones and **Save**:
   - `RAZORPAY_KEY_ID`: the live Key Id (`rzp_live_` …).
   - `RAZORPAY_KEY_SECRET`: the live Key Secret. **Never paste this secret into
     chat.**
4. Still in **Live** mode: **Accounts & Settings** → **Webhooks** → **+ Add
   New Webhook**, exactly as in section 4:
   - the same URL (`…/functions/v1/payments/webhook`);
   - a **new** Secret of its own;
   - your Alert Email;
   - the same three events: `payment.authorized`, `payment.captured`,
     `refund.created`.
5. Put the new live webhook secret into Supabase:
   `RAZORPAY_WEBHOOK_SECRET` → **Save**. **Never paste this secret into chat.**
6. Check **Automatic Capture** is on in Live mode (section 4).
7. **Disable the test-mode webhook.** Switch the mode at the top to **Test** →
   **Accounts & Settings** → **Webhooks** → click the test webhook → set its
   status to **Disabled**, then switch back to **Live**.
   - **Why:** it points at the same function, which now holds the live webhook
     secret. Any test-mode event would fail its signature check and answer 400,
     and repeated failures send you alert emails. If a test-mode run is ever
     needed again, enable it again along with the test values.

**What changes:**
- The function now works in live mode: passes it writes are marked `live`.
- From here on, Claude's local test build no longer works against it. If a
  test-mode run is ever needed again, put the test values back first.

### Part B: one real purchase (once the notice is up, section 6)

/plans sells to real students from the moment the notice deploy finishes. So do
this right after that deploy finishes, before you announce anything.

1. On https://sawaalbox.in/plans, sign in with your own Google account and buy
   the pass with real money: **₹499**.
2. **Check the pass shows:** "Your pass is active until 24 May 2027". Razorpay
   (Live) → **Transactions** → **Payments** shows it Captured.
3. **Refund it** in the Razorpay dashboard (section 8, step 5).
4. **Check it switches off within minutes:** reload /plans; it offers Buy
   again. Or, in the SQL Editor:
   ```sql
   select status, refunded_at from passes where payment_id = '<payment id>';
   ```
   **Expect** `refunded` and a time.
5. If any step fails, delete `PUBLIC_PAYMENTS_FROM` in Render (**Save, rebuild,
   and deploy**) to take Buy away, then tell Claude.

## 8. Handling a refund request

The policy: a full refund within **7 days** of buying, if the student has used
**no more than the free taster** (one full past paper and one practice set).
Payment emails get an answer within 2 working days.

1. **Find their account.** Supabase → **Authentication** → **Users** → search
   their email → open the user → copy the **User UID**. If they wrote from a
   different address, ask them to write from the account's email.
2. **Check the 7 days.** In the **SQL Editor**, with their UID:
   ```sql
   select payment_id, status, valid_until,
          created_at at time zone 'Asia/Kolkata' as bought_india_time
   from passes
   where user_id = '<user id>' and mode = 'live'
   order by created_at desc;
   ```
   The request must come within 7 days of `bought_india_time`. Note the
   `payment_id` for step 5.
3. **Check the taster.** Count the tests they started on or after the paywall
   date. Put in your `PUBLIC_PAYMENTS_FROM` date:
   ```sql
   select kind, count(*) as started
   from test_attempts
   where user_id = '<user id>'
     and exam = 'upsc'
     and started_at >= '<paywall date> 00:00:00+05:30'
   group by kind;
   ```
   - `paper` is full past papers; `custom` is practice sets.
   - **Within the taster:** `paper` at most 1 and `custom` at most 1 (or no
     rows). Started tests count whether finished or not.
   - This sees only tests saved to their account. Tests on a device while
     signed out don't show here.
4. **If it qualifies**, refund. If not, reply with the policy (/refunds, "After
   7 days, or after more than the taster").
5. **Refund in Razorpay**, in **Live** mode:
   1. **Transactions** → **Payments** → open the payment with that id.
   2. Click **Refund Payment**. The **amount** is filled in with the full ₹499;
      leave it.
   3. Leave **Refund Instantly** unticked (a normal refund, free, typically
      5–7 working days to reach them).
   4. Click **Issue Full Refund**.
6. **The pass switches off by itself** within minutes, when `refund.created`
   reaches the function.
   - **Any refund, even a partial one, switches the pass off.** Never refund
     part of a payment unless you mean to end the pass.
7. **If it doesn't switch off**, check in the SQL Editor:
   ```sql
   select status, refunded_at from passes where payment_id = '<id>';
   ```
   - `refunded`: done.
   - Still `active` after 15 minutes: check the webhook (section 10). As a last
     resort, this switches it off by hand (it can only ever switch a pass off):
     ```sql
     update passes set status = 'refunded', refunded_at = now()
     where payment_id = '<id>' and status = 'active';
     ```
8. **Reply** to say the refund is issued, and that it usually reaches them
   within 5–7 working days.

## 9. If a student paid but has no pass

1. **Ask for** the payment id from Razorpay's receipt email (starts `pay_`),
   or the date and amount.
2. **Look up the payment** in Razorpay (Live) → **Transactions** →
   **Payments**:
   - **Captured:** money taken. Go to step 3.
   - **Authorized:** not completed yet. With automatic capture on, this clears
     within minutes. The webhook also completes it.
   - **Refunded:** see step 3; it is often a duplicate.
   - **Failed**, or not there: they were not charged (or not by us). Tell them.
3. **See what the database recorded:**
   ```sql
   select p.status, p.note, p.mode, p.valid_until, p.created_at, u.email
   from passes p left join auth.users u on u.id = p.user_id
   where p.payment_id = '<payment id>';
   ```
   - **`active`, with an email:** the pass is on, on the account with that
     email.
     - If it isn't the address they are using, they bought while signed in
       to another Google account.
     - Otherwise ask them to reload /plans while signed in.
   - **`refunded` with note `duplicate`:** they already had a pass. This
     second payment was refunded automatically, and their first pass is
     active.
   - **`refunded` with note `expired`:** the payment settled after the pass's
     last day (24 May 2027), so the function refunded it in full by itself and
     no pass was switched on. Nothing more to do; tell them the refund is on
     its way.
   - **No row:** the function never settled it. Go to step 4.
4. **Check the webhook delivery log.** Razorpay → **Accounts & Settings** →
   **Webhooks** (or **Developers** → **Webhooks**) → click the live webhook.
   - Recent deliveries show with their responses. Razorpay keeps only the last
     3 hours here.
   - **Failing deliveries:** see section 10. Once fixed, Razorpay's own retries
     (for 24 hours) switch the pass on by themselves.
   - **Older than that, or never delivered:** Razorpay support can replay one
     event up to 15 days old. Help → "Have a query?" → Technical Support →
     "Issue regarding Webhooks/API", with the payment id.
     - Razorpay documents no "Resend" button for webhooks. If your dashboard
       shows one on the delivery, it does the same thing.
   - **If none of this works within a working day:** refund the payment
     (section 8, step 5), tell the student, and ask them to buy again. Tell
     Claude what you saw.

## 10. When the webhook keeps failing

**How it fails:**
1. Razorpay treats any reply other than success as a failed delivery.
2. It retries for about **24 hours**.
3. Then it **disables the webhook** and emails your Alert Email.
4. While it is disabled, passes still switch on when the student's page
   confirms, but not for dropped confirmations, and refunds don't switch passes
   off.

**What to do:**
1. **Find the cause:**
   - Supabase → **Edge Functions** → `payments` → its logs. Lines start
     `payments:`, and name only a service and a status (no secrets).
   - Razorpay's webhook delivery log shows each delivery's response.
2. **Common causes:**

   | You see | Cause and fix |
   |---|---|
   | Deliveries answered **400** `bad_signature` | `RAZORPAY_WEBHOOK_SECRET` in Supabase doesn't match this webhook's Secret. Make up a new secret yourself and set the same value in both (Razorpay: the webhook → **Edit** → Secret → **Save Webhook**; Supabase: **Edge Functions** → **Secrets**). **Never paste this secret into chat.** This is separate from the Key Secret, which stays as it is. |
   | Deliveries answered **401** with a JWT message | JWT verification got turned back on. Section 2, step 6. |
   | Log line `razorpay 401` | The Key Id and Key Secret in Supabase are not a pair, or are from the other mode. Section 3, or section 7 part A. |
   | Log line `postgrest 401` (or another `postgrest` status) | The function can't write to the database. Check section 3's default secret key, then tell Claude. |
   | Log line `no_active_pass` | **On purpose, and very rare.** A student who already had a pass paid again, just as the pass's last day (24 May 2027) ended. The function won't treat it as a duplicate with no active pass to compare against, so it answers with an error and Razorpay retries. The next retry normally refunds it by itself as `expired`. **If the line keeps appearing:** find the payment in the webhook's delivery log, where the failing delivery's payload shows its `pay_` id (logs are kept only a short time, section 9 step 4), and **refund it by hand** (section 8, step 5). Refunding it stops the retries. Left alone for about 24 hours, the failures **disable the webhook for every student**. |

3. **Re-enable the webhook after fixing:** Razorpay → **Accounts & Settings**
   → **Webhooks** → click it → in the right-hand panel set the status to
   **Enabled**.

**Ignored on purpose (they don't fail):** log lines like
`webhook ignored a payment: not_your_order` or `payment_mismatch`. These are
payments not made through /plans, and the function leaves them alone.

**`user_gone`** means the student deleted their account before the payment
settled. There is no account to give the pass to: refund it by hand.

**Payments that settle after the pass has ended** (after 24 May 2027, India
time) are refunded in full by the function itself: nothing to do. The log line
is `refunded a payment made after the pass ended`, and the row has note
`expired`. A payment settled on 24 May itself still switches on a pass that
lasts only until the end of that day; sales close on 23 May, so this is rare.

**Check once, after 24 May 2027,** that nothing slipped through. This lists any
payment recorded as active that was settled after its pass had ended:

```sql
select payment_id, created_at at time zone 'Asia/Kolkata' as bought_india_time, valid_until
from passes
where status = 'active' and mode = 'live'
  and valid_until < (now() at time zone 'Asia/Kolkata')::date
  and (created_at at time zone 'Asia/Kolkata')::date > valid_until;
```

**Expect** no rows. Any row is a payment to refund by hand (section 8, step 5);
then tell Claude.
