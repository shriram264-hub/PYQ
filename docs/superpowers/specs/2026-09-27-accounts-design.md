# Accounts — sign-in, synced progress, bookmarks

Date: 2026-09-27
Status: Approved; implementation plan: docs/superpowers/plans/2026-10-02-accounts.md
Part 1 of 3 of the first paid bundle (1 accounts · 2 mock tests + analytics · 3 payments)

## Goal

Let a student mark questions as done or needing review, save questions into named
revision lists, and have all of it follow them across devices by signing in. Ships
as a free beta; the access model is shaped now for the paid "pass until exam day"
that part 3 will sell.

## Non-goals

- Payments, checkout, or enforcing paid access (part 3). The `entitlements` table
  exists but nothing reads it during the beta.
- Mock tests and analytics (part 2).
- Email sign-in. Deferred until a domain is registered — see Sign-in.
- Phone OTP. Per-SMS cost and DLT registration; revisit only if students ask.
- Any change to search or to the static page generation.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Auth and data provider | Supabase | Auth plus Postgres in one free tier (50k MAU, 500 MB) |
| Where logic runs | Browser → Supabase directly | The FastAPI backend sleeps after 15 min idle and takes 30–60 s to wake; user actions cannot wait on that |
| Security boundary | Postgres row-level security | Every row is readable and writable only by its owner |
| Sign-in | Google now, email link later | See Sign-in |
| Question key | `upsc-<year>-<q_no>` | See Question key |
| Launch | Free beta | Validates use before charging; beta users told upfront these become paid |
| Paid shape (future) | One-time pass valid until a date | Aspirants think in exam cycles; no auto-renewal |

## Question key

User data must reference questions by `<exam>-<year>-<q_no>`, e.g. `upsc-2019-7`.
**Never by the `id` field in `questions.json`.**

`id` is assigned by `enumerate()` in `data/scripts/extract_questions.py` — it is the
question's position in the PDF. Any re-extraction, including adding a new year's
paper, renumbers it, and every stored bookmark would silently point at a different
question. `(year, q_no)` was verified unique across all 3,959 questions with none
missing; prefixing the exam keeps it unique once other exams join.

The key is derived at build time in `site/src/lib/corpus.js` and emitted on each
question block as `data-qkey`, which is how client code finds it.

## Schema

All tables live in `public`, have row-level security enabled, and carry `user_id
uuid references auth.users on delete cascade` so deleting an account deletes its data.

```sql
create table question_progress (
  user_id      uuid not null references auth.users on delete cascade,
  question_key text not null,
  status       text not null check (status in ('done', 'review')),
  updated_at   timestamptz not null default now(),
  primary key (user_id, question_key)
);

create table bookmark_sets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table bookmarks (
  set_id       uuid not null references bookmark_sets on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  question_key text not null,
  added_at     timestamptz not null default now(),
  primary key (set_id, question_key)
);

create table entitlements (
  user_id     uuid primary key references auth.users on delete cascade,
  plan        text not null,
  valid_until timestamptz not null,
  source      text not null,
  created_at  timestamptz not null default now()
);
```

`bookmarks.user_id` duplicates what `set_id` implies. It exists so the row-level
policy is a single equality check instead of a join, which is both faster and
harder to get wrong.

### Row-level security

`question_progress`, `bookmark_sets`, `bookmarks`: select, insert, update and
delete all require `user_id = auth.uid()`. A `bookmarks` insert additionally
requires the referenced set to belong to the same user, so nobody can add to
someone else's list by guessing its id.

`entitlements`: **select only**, for the owning user. No client can insert or
update it. Part 3 writes it server-side after a verified payment, using a key that
never reaches the browser.

Migrations live in `supabase/migrations/` and are committed.

## Sign-in

Google sign-in through Supabase OAuth, working on the current `onrender.com` URL.

Email sign-in waits for the domain. Supabase's built-in mail sends 2 auth emails per
hour on the free tier and is documented as not for production. A real mail provider
(e.g. Resend) must verify a sending domain through DNS records, and `onrender.com`
is not a domain the product controls. When the domain exists, email magic links
are added with no schema change.

Sign-in redirect URLs are registered for the current origin and must be updated
when the domain changes — alongside `SITE_URL` in `render.yaml` and the backend's
`ALLOWED_ORIGINS`.

## Progress without an account

Progress works signed out, stored in `localStorage` under a versioned key. Signing
in is additive, not a precondition.

Only explicit actions are recorded — marking a question done or for review. Merely
viewing a question is not stored: syncing a write per page view would be chatty for
no feature in this bundle that needs it. Clearing a mark deletes the row.

**On first sign-in on a device, local progress merges into the account.** For each
question present in either place, the entry with the later `updated_at` wins; on an
exact tie the account's entry is kept. Nothing a student did before signing up is
discarded. After merging, the account
is the source of truth and the local copy is a cache for instant rendering.

## Page weight

`supabase-js` adds roughly 40–50 KB compressed. Signed-out visitors — the large
majority, and the ones who arrive from search engines — never download it. It is
fetched only when the visitor clicks Sign in, or when a stored session indicates
they are already signed in. This matters for an audience on mobile data, and keeps
the static pages exactly as fast as they are today.

## Interface

- **Header:** a Sign in control; when signed in, the account's initial with a menu
  (My lists, Sign out).
- **Each question block:** Mark done · Needs review · Save to list. Works signed
  out (local only) and signed in (synced).
- **`/account`:** the student's lists, questions in each, and a progress summary by
  subject. Signed-out visitors see what an account adds and a Sign in button.

Everything is progressive enhancement: with JavaScript disabled every page still
renders and reads fully; only the new controls are absent.

## Configuration

Three new build-time environment variables, all public by design:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_AUTH_PROVIDERS` — which sign-in providers the site shows; empty hides Sign in

The `service_role` key is never placed in the site, the repo, or any build
environment for the static site.

## Error handling

- Supabase unreachable: controls keep working against local storage and retry
  syncing later; the student is never blocked from marking a question.
- Sign-in cancelled or failed: return to the page they were on with a one-line
  explanation, not an error screen.
- A write rejected by row-level security indicates a bug, never an expected path;
  it is logged to the console and the local copy is kept.

## Testing

- **Row-level security** is the priority. SQL tests simulate two distinct users by
  setting JWT claims inside a transaction that is rolled back, and assert that user
  A cannot read, update, or delete user B's progress, sets or bookmarks, and that no
  user can write `entitlements`. No real accounts are created on the hosted
  project. These run in Supabase's SQL editor, or locally if Docker is installed.
- **Merge logic** is a pure function, unit-tested: later-wins, entries present on
  only one side, and identical timestamps.
- **Question key** derivation is tested against the corpus: every question gets a
  key, and all keys are unique.
- **Sign-in end to end** is verified manually by the product owner with their own
  Google account.
- The existing link checker must still pass.

## Prerequisites (owner)

1. Create a Supabase project.
2. Create a Google OAuth client and enable the Google provider in Supabase.
3. Provide the project URL and the publishable key. Never the `service_role` key.

The schema, policies, tests and interface can be written before these exist; nothing
can be verified end to end until they do.

## Open

- Whether beta users keep free access when payments launch. Decide before launch
  and state it to beta users upfront.
