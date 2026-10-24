# Payments: design

Date: 2026-10-24
Status: Agreed in conversation with the owner on 2026-10-24 ("nothing missing, write the spec and build this"). This document is for the owner's review before planning.

## Where this fits

This is part 3, project D. Mock tests and analytics are live and free during the beta. This project makes them part of a paid **UPSC Prelims pass**, and adds the way to buy it.

Already live (master 719c5cb, 2026-10-24):
- the Pricing, Refunds, Shipping and delivery, Plans and About pages;
- `site/src/lib/passes.js`, the single source of the pass facts.

The Plans page's button says "Coming soon".

The owner's Razorpay account:
- signed up on 2026-10-24 as an individual, with no GST and a savings account;
- CKYC verified;
- activation **submitted and under review**;
- test mode available, with the public test Key ID `rzp_test_TroLXHdtp0Xaj6`;
- the key secret is held by the owner. It must never appear in chat, the repo or the site.

## Intent

A student who has tried tests and analytics, and wants more, can buy the pass in under a minute. The pass works at once on every device they sign in on. The owner should never have to hand-fix an account, except for refunds, which the owner does in the Razorpay dashboard.

A pass must never switch on without a real, confirmed payment. A real payment must never fail to switch a pass on.

## What the owner decided

- **Product:**
  - "UPSC Prelims pass", **₹499**, one-time, no subscription;
  - valid until the end of **24 May 2027**, the day after Prelims 2027 (23 May 2027 on UPSC's calendar);
  - the price and dates come from `passes.js`.
- **Always free:** reading, search, marks, revision lists, the Revise page, and the basics on My progress.
- **Free taster:** one full past paper and one practice set, with their results.
- **Pass only:**
  - unlimited full papers and practice sets;
  - the "Your analytics" page;
  - the accuracy part of the subject and topic line;
  - Revise the questions you got wrong.
- **Buying:**
  - sign-in with Google is required, so the pass belongs to the account;
  - payment goes through Razorpay Checkout (UPI, cards, netbanking);
  - the Upgrade prompt appears at a locked feature and leads to /plans;
  - after paying, the student is returned to where they were, unlocked.
- **Refunds:** a full refund within 7 days, if no more than the taster was used. The student emails; the owner refunds in the Razorpay dashboard.
- **Receipt:** Razorpay's own email receipt. The site issues no invoice.
- **Contact:** city only, with no phone. Payment emails are answered "within 2 working days" (already live).

## What the student sees

### Before payments are switched on
Nothing changes. Everything stays free, as today.

Payments stay behind **one switch** in the site's settings (an environment variable), with the states off, notice and on (see below). It stays off until the owner turns it on after Razorpay approval. That lets the whole system be built, published and tested in Razorpay **test mode** without any student meeting a paywall or a test checkout.

### Notice before the paywall (owner's decision: 7 days)
The beta terms promise "we'll tell you before anything you use changes" (`LEGAL.betaTerms`). The switch therefore has **three states: off, notice and on.**

The owner sets the date the paywall starts. In the **notice** state, which lasts at least **7 days** before that date:
- a short banner appears on /upsc/test, the analytics page and My progress. It reads: "From [date], practice tests and analytics need the UPSC Prelims pass (₹499). You'll still get a free taster."
- the Terms and the Pricing page state the date.

Everything stays free until the date. When the date arrives, the paywall turns on by itself: the site compares today with the date.

### Rules settled while writing this up (my calls; the owner can override)
- **Results are always viewable.** This covers result pages and Past results, whether the test was taken in the beta, as a taster, or under a pass that has since expired or been refunded. A test started before the paywall date can still be resumed and submitted free. It doesn't count toward the taster.
- **Paying twice by accident** (two tabs, two orders). When a second captured payment arrives for a user and exam that already has an active pass, the server **refunds it in full automatically** through Razorpay's refund API and records it. The owner never has to spot duplicates. A dispute or chargeback doesn't switch the pass off automatically; the owner handles it in the Razorpay dashboard.
- **Test and live passes are kept apart in one Supabase project.**
  - Every pass row records whether it was bought in **test** or **live** mode. The functions set this from the key in use.
  - The site counts only rows matching its own mode, which it knows from its public key id.
  - Test passes therefore never unlock anything on the live site.
  - The owner's own test purchase doesn't block their real ₹499 check: create-order looks only at the same mode.
  - There is no second project to set up.
- **Sales close on Prelims day.** The pass facts gain a "sales close" date of 23 May 2027.
  - After it, create-order refuses, and Plans says the next year's pass is coming.
  - Before it, Plans and Checkout show plainly that the pass ends 24 May 2027.
  - A new year's pass is a one-entry change in the pass facts, in both copies.
- **Deleting an account.**
  - Payment rows are kept as financial records with the user detached (`on delete set null`).
  - Deleting an account doesn't trigger a refund; the refund policy decides.
  - The deletion steps in supabase/README.md and Privacy's "How long we keep it" section say so.
  - Privacy lists exactly what a pass row stores: payment id, order id, amount, dates, status and mode.

### When payments are on
- **The taster.**
  - A student, signed in or not, can start **one full paper** and **one practice set**.
  - "Started" counts, whether the test is finished, abandoned or still open; this is my call, so that abandoning doesn't refill the taster.
  - Only tests started **after payments were switched on** count, so beta users also get a fresh taster. My call.
  - The taster is counted from the tests this device holds. For a signed-in student that includes tests synced from their account. It is client-side, so it can be got around by clearing storage. The questions are public anyway, so the honest majority is what matters.
  - Results of taster tests stay viewable for good.
- **Upgrade prompt.** It appears where a pass is needed:
  - the papers list and the practice-set form on /upsc/test, once the matching taster is used;
  - the take page's Start button, likewise;
  - the analytics page;
  - Revise wrong answers;
  - the "Your tests and analytics" figures on My progress.

  The prompt is short: what the pass unlocks, ₹499, until 24 May 2027, and a **See the pass** link to `/plans?return=<current path>`. It is never a pop-up that blocks reading.
- **Subject and topic line.** Without a pass it shows only the coverage part ("Covered 12 of 422"). The accuracy part ("Your accuracy here…") needs the pass.
- **Plans page:**
  - Signed out: **Sign in with Google to buy**, which starts the existing sign-in flow and returns to /plans.
  - Signed in without a pass: **Buy for ₹499**, the page's one filled-green action.
  - Signed in with an active pass: "Your UPSC Prelims pass is active until 24 May 2027", plus links back to tests and analytics.
- **Paying:**
  1. Buy opens Razorpay's checkout window, prefilled with the student's name and email from Google.
  2. On success the page shows "Payment received. Switching on your pass…", then "Your pass is active until 24 May 2027".
  3. It then returns the student to the `return` path, if one was given and it is a same-site path, or offers links.
- **If something goes wrong:**
  - Payment cancelled or failed: a plain message, and nothing changes.
  - Paid, but confirming it on our side failed (for example, the connection dropped): the message says "If you were charged, your pass will switch on within a few minutes. If it hasn't after an hour, email hello@sawaalbox.in." The server's own Razorpay notification switches it on regardless.
- **After a refund:** when the owner refunds in Razorpay, the pass switches off automatically within minutes.

## How it works

### Data
A new table **`passes`** replaces the unused `entitlements` table, which is empty and read by nothing.
- **One row per paid pass:** id, user, exam (`'upsc'`), valid-until, Razorpay payment id (unique), Razorpay order id, amount in paise, status (`active` or `refunded`), created, and refunded-at.
- **Row-level security:** a signed-in user can read only their own rows. **Nobody can write from the browser.** Only the server functions, using the service role, insert or update rows.
- **The owner applies the migration** in the SQL editor, with an RLS test, as before.

### Server: three Supabase Edge Functions
These are small TypeScript functions on Supabase, the platform the site already uses. The owner deploys them from the dashboard, with step-by-step guidance. Their secrets are the Razorpay key secret and webhook secret, set in the Supabase dashboard and never anywhere else.
1. **create-order**
   - Signed-in only.
   - Refuses if the user already holds an active pass for the exam.
   - Creates a Razorpay order for 49900 paise INR. The order's notes carry the user id and the exam.
   - Returns the order id, the amount and the public key id.
2. **confirm-payment**
   - Signed-in only.
   - Receives the order id, payment id and signature that Checkout hands back, and **verifies the signature** with the key secret.
   - Fetches the payment from Razorpay's API to confirm it is captured, for the right order and amount, and that the order's user is the caller.
   - Then inserts the pass row. It is idempotent on the payment id, and it returns the pass.
3. **razorpay-webhook**
   - Called by Razorpay, not the browser, so it does not require sign-in.
   - **Verifies the webhook signature** with the webhook secret. It handles:
     - a captured payment: inserts the pass from the order's notes, if confirm-payment hasn't already;
     - a refund: marks the pass refunded.
   - This is the safety net for a student who paid but whose page never confirmed.

- **Valid-until.** The server computes it from its own copy of the pass facts (price, validity end). A unit test checks that copy against `site/src/lib/passes.js`, so the two can't drift. My call: a shared file would need a build step the dashboard deployment can't do.
- **Checkout script.** It is loaded from `checkout.razorpay.com` **only when Buy is pressed**. No page loads it otherwise.

### Browser
- **Pass state.**
  - For a signed-in student, the site reads their active pass for the exam (status `active`, valid-until in the future). It caches the result on the device, so pages don't wait on the network to decide what to show.
  - It refreshes on sign-in, on sync, and after a purchase. A signed-out visitor has no pass.
  - If the read fails or is offline, it trusts the cached answer. A student with no cache gets the free experience, never an error.
- **Access checks.** `canStartTest(exam, kind)` and `canSeeAnalytics(exam)` in `site/src/lib/tests/access.js` become the real checks:
  - payments switch off → yes;
  - otherwise an active pass → yes;
  - otherwise `canStartTest` → yes only while that kind's taster is unused;
  - otherwise `canSeeAnalytics` → no.

  **No other code may decide who has access.** That was already a rule.
- **Copy that depends on the switch.** These change automatically when payments go on:
  - Pricing, Refunds, Delivery and Privacy say "payments are not switched on yet" today;
  - the footer and About say tests and analytics are free during the beta;
  - the Plans page's Coming soon button.

  Any page that states this must read the switch.

### Setting up Razorpay
- **Webhook.** The owner adds a webhook in the Razorpay dashboard, in test mode first and later in live mode. It points at the razorpay-webhook function's URL, with a webhook secret, for the payment-captured and refund events.
- **Going live.** After approval, the owner:
  1. sets the **live** key secret and live webhook secret in Supabase;
  2. sets the live public Key ID and turns on the switch in Render's settings;
  3. makes one real ₹499 purchase;
  4. checks the pass switches on;
  5. refunds it, and checks the pass switches off.

## Constraints

- **Payment safety:**
  - a pass row is written **only** by the server, **only** after a verified signature and a confirmed payment;
  - the key secret and webhook secret never reach the browser, the repo or chat;
  - amounts come from the server, never from the browser.
- **Idempotent:** the same payment, seen by confirm-payment and by the webhook, or seen twice, makes exactly one pass.
- **Test mode before any student sees a checkout.** The full flow, including the webhook, the refund and the dropped-confirmation case, is proven in Razorpay test mode before the switch goes on. Test mode must never be reachable by real students on the live site.
- **Never block reading or searching.** No paywall touches question pages, search, marks or lists. Prompts are inline, never modal.
- **Exam-neutral:**
  - pass facts come from `passes.js` by exam;
  - functions take the exam as a parameter, checked against known exams;
  - nothing new hard-codes UPSC beyond the pass entry.
- **Existing constraints still bind:** DESIGN.md (one filled-green action per page), no layout shift, text via `textContent`, supabase-js lazy, page weight (the checkout script is loaded only on Buy), and `npm test` / build / check-links / detector clean.
- **Legal copy stays true.** When the switch is on:
  - Pricing, Refunds, Delivery, Terms and Privacy must describe what actually happens;
  - Privacy names Razorpay as the payment processor, in the present tense.

  When the switch is off, they say what they say today.
- **No real accounts, and no real money, in automated tests.**

## Testing

- **Unit tests:**
  - the access checks (switch off, pass, taster per kind, taster counting only tests started after the switch date, abandoned tests count);
  - the pass-state cache;
  - the return-path check (same-site only);
  - the server's copy of pass facts matching `passes.js`;
  - signature verification (order and payment signature, webhook signature) against Razorpay's documented algorithm, with known vectors;
  - the idempotent insert logic.
- **RLS test:** a user reads only their own passes; no user can insert, update or delete a pass; anon is refused.
- **End-to-end in Razorpay test mode,** before the switch goes on, driven by the builder and confirmed by the owner:
  1. buy, and the pass switches on;
  2. reload on another device, and the pass shows;
  3. drop the confirmation, and the webhook switches it on;
  4. refund in the dashboard, and the pass switches off;
  5. pay twice for the same order, and there is one pass;
  6. try to start a third taster test, and see the Upgrade prompt;
  7. buy from the prompt, and land back unlocked.
- **Headless checks:** the prompts and Plans states at 390 and 1280, light and dark, with CLS 0.

## Non-goals

- Subscriptions, auto-renewal, coupons or discounts, multiple plans, and gifting.
- Invoices, and GST handling: the owner isn't GST-registered.
- Self-serve refunds: refunds are handled by email and the dashboard.
- Passes for other exams: the design must allow them, but only UPSC is sold.
- Server-side enforcement of test access. Questions are public; access is enforced in the browser by design.

## Anti-goals

- **A pass that switches on without payment**, or a payment that leaves a student locked out.
- **A secret** in the repo, the browser or chat.
- **A paywall in front of reading or searching**, or a modal that blocks the page.
- **Students meeting Razorpay test mode** on the live site.

## Left to the builder

- The exact table and column names.
- The names of the functions and of the switch.
- The look of the prompts and the Plans states, within DESIGN.md.
- How the pass-state cache is stored and refreshed.
- How the end-to-end test-mode run is driven: headless against a local build talking to the test-mode functions, with the owner confirming in the Razorpay dashboard.
- The step-by-step owner guide for deploying the functions and setting secrets and the webhook, written for someone who has never used Edge Functions.
