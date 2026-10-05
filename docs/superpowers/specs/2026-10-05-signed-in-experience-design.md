# Signed-in experience — header, list management, revise page

Date: 2026-10-05
Status: Approved in conversation (header, lists, revise page — each section approved by the owner); spec for the owner's review
Builds on: `docs/superpowers/specs/2026-09-27-accounts-design.md` (accounts part 1, live since 2026-10-05)

## Problem

Accounts went live on sawaalbox.in on 2026-10-05. Testing it, the owner found two problems:

1. After signing in, the only way to reach progress and lists is a small square holding the student's initial in the header. It isn't discoverable.
2. Revision lists on "Your progress" are plain. Each list is a long run of question links, and a list can't be renamed, deleted or revised as a set. Two near-duplicate lists, "test" and "Test", already exist.

## Decisions (owner, 2026-10-05)

| Question | Decision |
|---|---|
| Header entry point | Both: a "My progress" nav link and a labelled "My account" button with a menu |
| What lists should do | All three: open a list to revise, manage lists (rename, delete, no case-only duplicates), cleaner overview |
| Needs review | Opens on the same revise page as a list |
| How the revise page gets full question text | Approach A: a revise page plus per-year full-question files, fetched only for the years a list uses |

## 1. Header

- **"My progress" nav link, for everyone.**
  - It joins every nav: the homepage mast ("Exams · What's inside"), the /upsc cover mast, and the shared Masthead inside exams ("Subjects · Years · Search").
  - It is server-rendered and always present, signed in or not. Marks and lists work on a device without an account, so the link is useful to everyone. Because it is always there, nothing shifts when the session check ends.
  - It links to `/account`.
  - It is shown whether or not sign-in is configured. "My progress" is not account wording: with sign-in off, /account just says "Kept on this device."
- **Signed out:** the Sign in button, unchanged.
- **Signed in:** the initial-only square becomes a labelled button.
  - Contents: the initial, the text "My account", and a disclosure caret drawn in CSS. DESIGN.md forbids Unicode glyph icons.
  - It stays a disclosure, not an ARIA menu: `aria-expanded` and `aria-controls`, as today.
  - The panel holds, in order:
    - "Signed in as {name}", as plain text, using the Google full name, else the email.
    - "My progress", linking to `/account`.
    - "My lists", linking to `/account#lists`.
    - "Sign out", which keeps today's busy behaviour.
- **Phones:**
  - Below a breakpoint chosen so the header stays one row at 360px, the button shows only the initial and the caret. "My account" stays as visually hidden text, so the accessible name is unchanged.
  - The control's space is reserved, as today, so CLS is 0 at 360 and 390px with the flag on and off.
- **Where it applies:** all three headers that carry `AccountControl`.

## 2. Lists on "Your progress"

### Overview

- **Two entry points, one page.** "My progress" opens `/account` at the top. "My lists" opens `/account#lists`, a stable `id="lists"` on the Revision lists section that brings it into view.
- **A Needs review card**, first in that area:
  - It reads "Needs review", then "{n} questions" (a count of 0 is fine), then the subjects covered, then a **Revise** link to `/revise?review`.
  - It replaces today's inline needs-review list of links.
- **One card per list**, in A–Z order by name:
  - It shows the name, "{n} questions", the subjects covered, and a **Revise** link to `/revise?list={listId}`.
  - Subjects covered show the first two by count, then "+{k} more". They are computed from the per-year index that /account already loads.
  - An empty list shows "No questions yet: use Save to list on any question." and has no Revise link.
  - **Rename** and **Delete** are text buttons on the card. There are no glyph icons.
- **Questions leave the overview.** They now live on the revise page, which is also where a question is removed from a list. The "By subject" table stays as it is.

### Rename

- **The edit.** Rename turns the name into a labelled text field with Save and Cancel. Escape cancels, and focus returns to the Rename button.
- **Validation.** A name is 1–80 characters after trimming (`MAX_NAME`). It must not equal another list's name **case-insensitively**, compared after trimming with `toLowerCase()`. The message reads: `You already have a list called "{existing}".` Messages are announced through the page's status region.
- **Sync.**
  - A renamed list is dirty: its name differs from `syncedName`, the name this device last saw on the account.
  - The next run updates `bookmark_sets.name` for that `remoteId`. The `authenticated` UPDATE grant and the owner policy already allow this.
  - When the account's name differs from `syncedName` and this device has not renamed the list, the list was renamed elsewhere. Adopt the account's name.
  - When both sides renamed it, this device's rename is pushed. The last device to sync wins.
  - When the account refuses the rename because a list with that name exists there (unique violation, which only happens when another device created one since the last pull), drop the rename: the local name reverts to the account's name, and the next run is not blocked.

### Delete

- **Confirming.** Delete opens an inline confirmation inside the card, not a modal:
  - It reads `Delete "{name}" and its {n} saved questions? This removes it on all your devices.`
  - It offers **Delete list** and **Cancel**.
  - Focus moves to Cancel, and Escape cancels.
- **Effect on the device.** The list is removed from the device at once.
  - If it has a `remoteId`, that id joins `state.deletedLists`, a tombstone that is kept until the account confirms the deletion.
  - A list with no `remoteId` (never synced) is simply removed.
- **Sync.**
  - The next run deletes `bookmark_sets` rows whose ids are tombstoned. Their bookmarks go by cascade.
  - Each tombstone is cleared once its delete succeeds. A set already gone from the account also clears its tombstone.
  - `mergeLists` never adopts a remote set whose id is tombstoned, so a deletion made offline cannot come back.
  - Another device drops the list on its next full lists pull, because its set is gone. If that device had added questions to the list offline, the deletion still wins.
- **Marks are untouched.** Deleting a list does not change Mark done or Needs review.

### Near-duplicates

- **New lists and renames.** Both reject a name that equals an existing list's case-insensitively.
- **First sign-in merge.** A list without a `remoteId` joins an account set whose name matches case-insensitively, instead of creating a near-twin. The database's `unique(user_id, name)` is case-sensitive, so this check lives in the client.
- **Existing duplicates.** Lists that already differ only in case, such as the owner's "test" and "Test", are left as they are. The owner deletes one.
- **No migration.**

### State shape (additive)

`lists[id]` gains `syncedName: string | null`:
- It holds the name this device last saw on the account.
- It is `null` until first synced.
- `parseState` defaults it to `name` when the list has a `remoteId`, and to `null` otherwise, so existing data needs no migration.

`state` gains `deletedLists: string[]`, a list of remote set ids awaiting deletion:
- `parseState` validates it as an array of strings, defaulting to `[]`.
- The owner rebase (`rebaseForNewAccount`) clears it, because a previous account's tombstones must never act on the next account.

`isDirty(list)` also becomes true when `remoteId && name !== syncedName`. The lists step also runs when `deletedLists` is non-empty.

### Sync order and settle

- **Push order inside the lists step:**
  1. Delete tombstoned sets.
  2. Rename sets, in dependency order: a rename onto a name another set is leaving in the same run goes after that rename.
  3. Create new sets. This comes after deletes and renames because a new list may reuse a name they free, and the account refuses duplicate names.
  4. Add bookmarks.
  5. Delete bookmarks.
- **Unchanged invariants.**
  - The lists step runs inside the existing single-flight run.
  - A request error throws before anything is saved, which leaves local state untouched.
  - The settle step keeps changes made during the run: renames, deletions and creations made while it awaited the network are re-applied. Tombstones added mid-run survive.
  - `sawaalbox:synced` fires only after a successful save.

## 3. Revise page

- **Route.** `/revise`. It is static, `noindex`, and left out of the sitemap.
  - `?list={listId}` opens a list. `?review` opens the Needs review pile.
  - Anything else shows the "isn't on this device" message.
- **Header.**
  - The title is the list name, or "Needs review".
  - Below it come "{n} questions" and the subjects covered.
  - A "Back to your progress" link points to `/account#lists`.
- **Questions.**
  - Each question uses the **same markup and behaviour as a question block elsewhere**:
    - the serial (year · Q{n}), linking to the question's own page
    - subject, then topic
    - the question text and options
    - status flags (cancelled or disputed)
    - the existing marks slot with Mark done, Needs review and Save to list
    - the answer, sealed behind Show answer
  - Rendering shares one module with the search page's client renderer. `questionHTML` moves out of `search.astro` into a shared module that both pages import, with no change to search output; a test pins it.
- **In a list**, each question also has **Remove from this list**.
  - It removes the key with `removeKey`, saves, and dispatches `sawaalbox:list`.
  - The question leaves the page, and the result is announced.
- **Order.**
  - A list shows questions in the order they were saved, which is the `keys` array order.
  - Needs review shows the oldest mark first.
  - A question marked Done while revising Needs review stays on the page, shown as done, until the next visit.
- **Paging.**
  - 20 questions render at first. A **Show 20 more** button appends the next 20 and keeps focus on the first newly added question.
  - The count in the header always shows the total.
- **Data: per-year full-question files.**
  - The files are `/{exam}/full/{year}.json`, built as a static endpoint per exam and year, alongside Task 8's `/{exam}/index/{year}.json`.
  - Each maps a question key to the fields the shared renderer needs and nothing more.
  - The page fetches only the years its keys use, in parallel, through the same loader pattern as /account: timeout, `online` retry, and only same-site question paths become links.
  - Target size is about 20 KB gzip per year. The build verifies the real sizes, and the plan records them.
- **States.**
  - Loading reads "Loading {n} questions…".
  - A failed year reads "Couldn't load questions from {year}." with a **Try again** button.
  - A key that is absent from a loaded file shows as its serial with no content.
  - An unknown or deleted list id, or a list not on this device, reads "This list isn't on this device." with a link to Your progress.
  - An empty list says to use Save to list. An empty Needs review pile reads "Nothing marked for review."
  - With JavaScript off, a `<noscript>` line explains that the page needs JavaScript.
- **Signed out.** The page works with the device's own lists and marks.
- **Signed in.** The page runs the normal sync, not a forced full pull. The /account visit that leads here already fetched the latest.

## Global constraints (unchanged, restated)

- **Design.** `DESIGN.md` applies: tokens only, square corners, one filled-green action per page, no Unicode glyph icons, contrast of at least 4.5:1 in both themes.
  - The page's primary action decides which control, if any, is filled green.
  - The detector runs on every changed UI file.
- **No layout shift** from anything the scripts inject: header, cards or revise blocks.
- **supabase-js** is never in the initial bundle and never loads for signed-out visitors without a stored session.
- **Rendering.** Everything rendered from storage, the indexes or the URL goes through `textContent` or the shared escaper. Only same-site question paths become links.
- **Progressive enhancement.** Every content page reads fully with JavaScript off. /account and /revise are app pages and carry a `<noscript>` line.
- **Mobile data.** Nothing new loads on question pages. /revise loads only the year files it needs.
- **Checks.** `npm test`, the build, and `node scripts/check-links.mjs` must pass.
- **Privacy page.** It is checked against the new files. They are public question data and change nothing about personal data, so no edit is expected.

## Testing

- **Unit tests for the pure logic:**
  - case-insensitive name checks for create and rename
  - rename merge: here, elsewhere, both, and refused by the account
  - delete tombstones: offline delete not resurrected, tombstone cleared on success and when the set is already gone, rebase clears tombstones
  - `parseState` defaults for `syncedName` and `deletedLists`
  - year files needed for a list
  - subjects covered (top two plus a count)
  - review order
- **Sync tests with the existing two-user fake client:**
  - rename and delete reach the account and the other device
  - a deletion made offline survives reconnection
  - a mid-run rename or delete is kept
  - push order is honoured
- **Renderer test:** `questionHTML` output for sample results is unchanged after the move.
- **Headless browser checks on the production build** (flag on, scratch output only):
  - the header at 360, 390 and 1280px, signed out and signed in, light and dark, with CLS 0
  - the My account panel with keyboard and Escape
  - "My lists" scrolls to the lists
  - the card Rename and Delete flows
  - /revise for a list, for Needs review, for an empty list and an unknown id, with Show 20 more and a failed year
  - Remove from this list
  - accessible names
  - screenshots of each
- **Size check:** record the per-year full-file sizes, raw and gzip.

## Non-goals

- Reordering lists, or reordering questions within a list.
- Sharing lists, list notes, printing.
- Timed or scored revision; mock tests belong to part 2.
- Searching within lists.
- A separate "My lists" page.
- Any database migration.
