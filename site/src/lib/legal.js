// Who runs SawaalBox and the promises its legal pages make, kept in one place:
// /privacy, /terms, /contact and /account all read them from here, so a change
// of address or reply time is one edit.
//
// FACTS INVENTORY (checked 2026-10-03). Every statement on /privacy, /terms and
// /contact traces to an item below. When the code changes what is stored or
// sent, update this list and the pages together, and move `updated`.
//
// Signed out
//  1. Marks and revision lists are saved in this browser's localStorage under
//     `sawaalbox-progress-v1` (lib/accounts/progress-store.js:6): per question
//     key its status ('done' | 'review'), when it was set and whether it has
//     synced (progress-store.js:45, :104), a queue of unsynced changes
//     (progress-store.js:110-111), and lists as name + question keys
//     (progress-store.js:29). Nothing is sent anywhere while signed out:
//     syncing starts only on `sawaalbox:signed-in` (components/AccountControl.astro:35).
//  2. The theme choice is saved under `sawaalbox-theme`, 'light' or 'dark'
//     (components/ThemeToggle.astro:55; read before paint in layouts/Document.astro:33).
//  3. Search sends the search text and the chosen filters (subject, years,
//     difficulty) plus paging to the search API as a GET query string
//     (pages/upsc/search.astro:7, :198-204), with no cookies or account
//     headers, so a search is never tied to an account. The search also sits
//     in the page's address (search.astro:185 replaceState; the /upsc cover's
//     form is a GET to /upsc/search, pages/upsc/index.astro:55), so it lands
//     in browser history and in the website host's request records.
//  4. The API (backend/app/main.py) stores nothing and has no logging of its
//     own, but it runs under uvicorn with its default access log on
//     (render.yaml:16 has no --no-access-log; uvicorn 0.34 Config access_log=True),
//     which writes one line per request with the path including the query
//     string (so the search text) and the client address. Render keeps that
//     output as the service's logs; we do not set their retention.
//  5. No analytics, ads, trackers or third-party scripts: a grep of site/src,
//     site/public and backend/app for analytics/gtag/adsense/pixel/sentry and
//     similar finds nothing, and the only external origin the site calls is
//     the search API (search.astro:7). Fonts are self-hosted through
//     fontsource (styles/document.css:1-5).
//  6. No cookies: nothing in site/src touches document.cookie, and the
//     supabase-js build used here keeps its session in localStorage, not a
//     cookie (item 8).
//
// Signed in (only once lib/accounts/config.js:11 `authEnabled` is true)
//  7. Sign-in is Google OAuth through Supabase Auth (scripts/auth.js:52-63).
//     Supabase Auth keeps the Google profile it is given: name, email address,
//     profile picture URL and the Google account's ID. The site reads only the
//     name or email, for the initial on the account button (scripts/account.js:34).
//  8. supabase-js keeps the session, which includes the user's email and
//     profile, in localStorage under `sb-<project>-auth-token`
//     (lib/accounts/config.js:14-15; auth.js:10 persistSession with no custom
//     storage; @supabase/auth-js GoTrueClient storage = globalThis.localStorage),
//     plus a PKCE code verifier during sign-in (auth.js:26). Sign-out first
//     gives the sync one last run of at most 3 s (auth.js finishSyncing), then
//     removes the session and nothing else: marks and lists stay in this
//     browser after sign-out (sync.js onSignedOut forgets only the pull
//     markers). When a different account next signs in on this browser, the
//     previous account's synced marks and synced lists are removed from it
//     before anything is merged (merge.js rebaseForNewAccount, sync.js
//     claimDevice); marks and lists never synced join the account signing in.
//     It is loaded only when someone presses Sign in or a session is already
//     stored (auth.js:5-7, account.js:47).
//  8a. Sign-in returns to the page it started on, query string included, so a
//     search on that page is passed through Supabase's sign-in redirect
//     (auth.js:54-60 redirectTo).
//  9. Synced to Supabase (supabase/migrations/20261002120000_accounts.sql):
//     question_progress (question key, status, updated_at; :4-10, written by
//     scripts/sync.js:54-58), bookmark_sets (list name, created_at; :12-18,
//     sync-lists.js:72-75), bookmarks (question key, added_at; :22-28,
//     sync-lists.js:88). A copy stays in this browser (item 1), with two pull
//     markers `sawaalbox-sync-v1` and `sawaalbox-sync-lists-v1` holding the
//     user id and a time (scripts/sync.js:20, sync-lists.js:18, lib/accounts/pull.js:52),
//     removed on sign-out, and `sawaalbox-owner-v1` holding the id of the
//     account whose data this browser holds (the last to sign in here), kept
//     after sign-out so the next account to sign in here is recognised
//     (lib/accounts/pull.js OWNER_KEY).
// 10. Access rules: row-level security on every table; each signed-in user can
//     read and change only their own rows, and nobody signed out can reach them
//     (migration :40-77).
// 11. Deleting the account deletes the data: every table references auth.users
//     `on delete cascade` (migration :5, :14, :24, :33). Deletion is done by the
//     operator on request; the site has no self-serve delete. Supabase's
//     sign-in audit rows (auth.audit_log_entries) have no foreign key to
//     auth.users, so they outlive the cascade and are purged by hand as part
//     of the same request: supabase/README.md "Deleting a student's account
//     on request".
// 12. `entitlements` exists (migration :32-38) but nothing reads or writes it
//     (grep site/src, backend/app: no match). No payments exist anywhere.
// 13. Supabase may also log each sign-in and each sync request (time, IP
//     address, browser) as part of its standard Auth and API services, kept
//     for its own log period. Not visible from this repo, so the pages say
//     "may" where they describe it.
//
// Hosts and processors
// 14. Render hosts the static site and the search API (render.yaml:1-54). Both
//     hostnames resolve to gcp-us-west1-1.origin.onrender.com (DNS, 2026-10-03),
//     i.e. the United States. Any web host sees the visitor's IP address and
//     browser details with each request.
// 14a. Cloudflare carries the traffic: the Render hostnames are CNAMEs to
//     gcp-us-west1-1.origin.onrender.com.cdn.cloudflare.net, and the Supabase
//     project host resolves to Cloudflare addresses (104.18.38.10,
//     172.64.149.246) (DNS, 2026-10-03). No location is claimed for it.
// 15. Supabase holds accounts and synced data (render.yaml:47-48), in Mumbai,
//     India (ap-south-1): region confirmed by the owner, 2026-10-03.
// 16. Google runs the sign-in step itself (auth.js:59, provider 'google').
// 16a. hello@sawaalbox.in is hosted by Zoho Mail (Zoho Corporation), so Zoho
//     handles emails people send: confirmed by the owner, 2026-10-03, and
//     tested for sending and receiving. No location is claimed for it.
// 17. Connections are HTTPS: the site, the API and Supabase are all https://
//     origins (render.yaml:21, :40, :44, :48).
//
// Content
// 18. Questions are credited to their paper through EXAMS[].source
//     (lib/exams.js:17) and the Colophon. Questions, answers, subjects, topics,
//     difficulty and cancelled/disputed status were extracted from a
//     compilation PDF (PRODUCT.md "Evidence on Hand";
//     data/scripts/extract_questions.py:26, :109-114). No subject expert has
//     audited them (PRODUCT.md). Cancelled and disputed questions are flagged
//     (components/QuestionBlock.astro:26-27).
// 19. The search API is on Render's free tier and sleeps when idle, so it can
//     be slow or unavailable (PRODUCT.md "Hard technical constraints").
// 20. SawaalBox has no institutional endorsement or affiliation (PRODUCT.md).

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const LEGAL = Object.freeze({
  operator: 'Shriram Agrawal',
  email: 'hello@sawaalbox.in',
  place: 'Bengaluru, Karnataka',
  // The date on all three pages. Move it whenever their wording changes.
  updated: '2026-10-03',
  // The owner's words, used verbatim on /terms and /account.
  betaTerms: "Free during the beta. Some features may later need a paid pass; we'll tell you before anything you use changes.",
  minAge: 18,
  // How long a reply to an email (a data request, a grievance) may take.
  replyDays: 30,
});

/**
 * '2026-10-03' -> '3 October 2026'. Spelled out by hand rather than with
 * toLocaleDateString, whose output depends on the build machine's ICU data
 * and time zone.
 */
export function longDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`not an ISO date: ${iso}`);
  const [year, month, day] = match.slice(1).map(Number);
  // Date.UTC rolls an impossible day over (31 February becomes 3 March), so a
  // date is real only if it comes back unchanged.
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) {
    throw new Error(`not an ISO date: ${iso}`);
  }
  return `${day} ${MONTHS[month - 1]} ${match[1]}`;
}
