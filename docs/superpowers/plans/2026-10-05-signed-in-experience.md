# Signed-in Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the signed-in experience discoverable and lists useful. Every header gets a "My progress" link and a labelled "My account" menu. Lists on /account become cards with Rename, Delete and Revise. A new /revise page shows a list, or the Needs-review pile, in full.

**Architecture:**
- **List logic stays pure in `lib/accounts/lists.js`.** It gains rename, delete tombstones, case-insensitive names and `syncedName`.
- **List sync** in `scripts/sync-lists.js` deletes and renames sets in a fixed order, inside the existing single-flight run.
- **The search page's client renderer** (`questionHTML`) moves into a shared module. The new `/revise` page renders full questions with it, from per-year full-question files, fetched only for the years a list uses.
- **The header** gains a server-rendered "My progress" link and a labelled disclosure button.

**Tech Stack:** Astro 7 (static), vanilla ES modules, supabase-js v2 (already lazy), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-05-signed-in-experience-design.md` (owner-approved 2026-10-05). Read it before your task; it is the authority. Background: `docs/superpowers/specs/2026-09-27-accounts-design.md`.

**Branch:** `signed-in-ux` in `C:\Users\shrir\Downloads\UPSC_project\.claude\worktrees\accounts`. It is rebased on live master 65b2faf. Run git there and npm in `site/`. Never push.

## Global Constraints

- **Design.** `DESIGN.md` applies: tokens only, square corners, one filled-green action per page, no Unicode glyph icons, contrast of at least 4.5:1 in both themes.
  - The page's primary action decides which control, if any, is filled green.
  - The detector runs on every changed UI file: `C:\Users\shrir\.claude\skills\impeccable\scripts\impeccable.cmd detect --json <files>`. Expect `[]`. The homepage `.slot::after` side-tab is a recorded, sanctioned exception.
- **No layout shift** from anything the scripts inject: header, cards or revise blocks. CLS is 0 at 360 and 390px, with the flag on and off.
- **supabase-js** is never in the initial bundle and never loads for signed-out visitors without a stored session.
- **Rendering.** Everything rendered from storage, the indexes or the URL goes through `textContent` or the shared escaper. Only same-site question paths become links.
- **Progressive enhancement.** Every content page reads fully with JavaScript off. /account and /revise are app pages and carry a `<noscript>` line.
- **Mobile data.** Nothing new loads on question pages. /revise loads only the year files it needs.
- **Checks.** `npm test`, `npm run build` and `node scripts/check-links.mjs` must pass.
- **Invariants from accounts part 1 that must still hold:**
  - `sync.js` and `sync-lists.js` never import `marks.js` or `save-to-list.js`.
  - Single-flight runs, with one coalesced follow-up.
  - Merge first; deletes are conditional.
  - Settle steps keep changes made during a run.
  - `sawaalbox:synced` fires only after a successful save.
  - Pull markers are cleared on sign-out.
  - The device owner is claimed at rebase.
  - `rebaseForNewAccount` must never let one account's data act on another's.
- **Test environment.** Tests use `node:test`. The sync tests use the fake Supabase client in `site/tests/sync.test.js` (`fakeClient`, `seed`, `idle`, `slowNetwork`, `writeListsMarker`). Never create real accounts on the hosted project.
- **Scratch files.** Headless-browser scripts go in the session scratchpad (`C:\Users\shrir\AppData\Local\Temp\claude\C--Users-shrir-Downloads-UPSC-project\7252f56d-4445-4291-ac44-3c8ab2940d5d\scratchpad`), never the repo. Screenshots go to `C:/Users/shrir/Downloads/UPSC_project/.impeccable/review/sx-*.png`. Flag-on builds (`PUBLIC_AUTH_PROVIDERS=google`) go to a scratch `--outDir`, and the flag is never committed. It is already `google` in `render.yaml` and `site/.env`, so a default build is flag-on. For a flag-off check, build with `PUBLIC_AUTH_PROVIDERS=` into a scratch outDir.
- **Commits.** Conventional commits, each ending with a blank line, then `Co-Authored-By: Claude <model> <noreply@anthropic.com>` naming the model that did the work.

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `site/src/lib/accounts/lists.js` | Pure list ops: names (case-insensitive), create, rename, delete with tombstones, three-way merge with renames and deletes, settle | 1 |
| `site/src/lib/accounts/progress-store.js` | State shape: `syncedName`, `deletedLists`; parse defaults | 1 |
| `site/src/lib/accounts/merge.js` | `rebaseForNewAccount` clears `deletedLists` | 1 |
| `site/src/scripts/sync-lists.js` | Push order: delete sets, create, rename, add, remove; tombstone settle; rename refusal | 2 |
| `site/src/components/AccountControl.astro`, `site/src/scripts/account.js` | Labelled "My account" disclosure and its panel | 3 |
| `site/src/components/Masthead.astro`, `site/src/pages/index.astro`, `site/src/pages/upsc/index.astro` | "My progress" nav link | 3 |
| `site/src/lib/accounts/summary.js` | `subjectsCovered`, `reviewOldestFirst` | 4 |
| `site/src/pages/account.astro`, `site/src/scripts/progress-page.js` | Needs review and list cards, Rename and Delete UI, `id="lists"` | 4 |
| `site/src/lib/question-html.js` | Shared question renderer, moved from `search.astro` | 5 |
| `site/src/pages/upsc/full/[year].json.js` | Per-year full-question files | 5 |
| `site/src/pages/revise.astro`, `site/src/scripts/revise-page.js` | The revise page | 6 |

---

### Task 1: List logic: names, rename, delete tombstones, merge and settle

**Files:**
- Modify: `site/src/lib/accounts/lists.js`, `site/src/lib/accounts/progress-store.js`, `site/src/lib/accounts/merge.js`
- Test: `site/tests/lists.test.js`, `site/tests/progress-store.test.js`, `site/tests/merge.test.js`

**Interfaces:**
- **Consumes:** existing `createList`, `toggleKey`, `removeKey`, `isDirty`, `listsEqual`, `mergeLists`, `settleLists`, `parseState`, `emptyState`, `rebaseForNewAccount`.
- **Produces:**
  - List shape: `{ name, keys, remoteId, syncedKeys, syncedName }`. `syncedName` is `string|null`, the name this device last saw on the account, and `null` until first synced.
  - State shape: `{ entries, pending, lists, deletedLists }`, where `deletedLists` is `string[]` of remote set ids awaiting deletion.
  - `sameName(a: string, b: string): boolean`. Trim both, then compare `toLowerCase()`.
  - `findByName(lists, name, exceptId?): {id, list} | null`. Case-insensitive.
  - `createList(state, name, id)` now rejects a case-insensitive duplicate. Its message is `You already have a list called "${existing.name}".`, using the existing list's own spelling.
  - `renameList(state, listId, name): State`. It cleans the name with `cleanName`. It throws the same duplicate message when another list (not this one) has the name case-insensitively. It returns `state` unchanged for an unknown list or an identical name.
  - `deleteList(state, listId): State`. It removes the list. If the list had a `remoteId`, that id is appended to `state.deletedLists`, with no duplicates. It returns `state` unchanged for an unknown id.
  - `isDirty(list)` is also true when `list.remoteId !== null && list.name !== list.syncedName`.
  - `listsEqual(a, b)` also compares `syncedName`.
  - `mergeLists(localLists, remoteSets, remoteBookmarks, deletedLists = [])` returns `{ lists, createSets, addBookmarks, deleteBookmarks, renameSets, deleteSets }`:
    - `renameSets` is `[{ listId, name }]`. `name` is the new name to write to the account.
    - `deleteSets` is `[remoteId]`, the tombstoned ids that still exist in `remoteSets`.
    - A remote set whose id is in `deletedLists` is never merged into a local list and never adopted. A local list whose `remoteId` is tombstoned is dropped.
    - **Name of a list with a `remoteId` whose set exists.** It was renamed here when `syncedName !== null && name !== syncedName`.
      - If it was renamed here and `set.name !== name`, push `{ listId, name }` to `renameSets`. The result has `name = local name` and `syncedName = local name`.
      - Otherwise the result takes the account's name: `name = set.name` and `syncedName = set.name`.
    - **A list without a `remoteId`** joins a remote set by name case-insensitively. An exact-case match is preferred, then the first match in `remoteSets` order. Folding into a list already being created uses the same case-insensitive rule. The result's `syncedName` is the set's name. A list whose set is being created gets `syncedName = name`.
    - **Adopted sets** get `syncedName = set.name`.
  - `settleLists(snapshot, current, merged)` additionally:
    - A list renamed during the run (`current[id].name !== snapshot[id].name`) keeps the current name over the merged one, with `syncedName` left as merged.
    - A list present in `snapshot` and `merged` but gone from `current` (deleted during the run) is dropped from the result.
  - `settleTombstones(snapshotIds: string[], currentIds: string[]): string[]` returns `currentIds` without the ids the run handled (`snapshotIds`).
  - `parseState`:
    - `deletedLists` must be an array of strings, defaulting to `[]`.
    - A list's `syncedName` defaults to `name` when the list has a `remoteId` and to `null` otherwise. It must be `string|null`.
    - `emptyState()` includes `deletedLists: []`.
  - `rebaseForNewAccount(state)` returns `deletedLists: []`.

- [ ] **Step 1: Write failing tests.** Add to `site/tests/lists.test.js`. Adapt the import list to the file's existing imports.

```js
import { createList, renameList, deleteList, findByName, sameName, isDirty, mergeLists, settleLists, settleTombstones } from '../src/lib/accounts/lists.js';
import { emptyState } from '../src/lib/accounts/progress-store.js';

const L = (name, keys = [], remoteId = null, syncedKeys = [], syncedName = remoteId ? name : null) => ({ name, keys, remoteId, syncedKeys, syncedName });

test('names compare without case or surrounding space', () => {
  assert.equal(sameName(' Test ', 'test'), true);
  assert.equal(sameName('Polity', 'Polity 2'), false);
});

test('createList refuses a name that differs only in capitals, quoting the existing spelling', () => {
  const s = createList(emptyState(), 'Test', 'L1');
  assert.throws(() => createList(s, 'test', 'L2'), { message: 'You already have a list called "Test".' });
  assert.deepEqual(s.lists.L1, L('Test'));
});

test('renameList renames, refuses another list\'s name, and ignores no-ops', () => {
  let s = { ...emptyState(), lists: { L1: L('Polity', [], 'R1', [], 'Polity'), L2: L('Maps') } };
  s = renameList(s, 'L1', '  Indian Polity ');
  assert.equal(s.lists.L1.name, 'Indian Polity');
  assert.equal(s.lists.L1.syncedName, 'Polity'); // still the account's name until a sync
  assert.equal(isDirty(s.lists.L1), true);
  assert.throws(() => renameList(s, 'L1', 'maps'), { message: 'You already have a list called "Maps".' });
  assert.equal(renameList(s, 'L1', 'Indian Polity'), s);
  assert.equal(renameList(s, 'nope', 'X'), s);
  assert.equal(renameList(s, 'L2', 'MAPS').lists.L2.name, 'MAPS'); // own name in new capitals is fine
});

test('deleteList removes the list and keeps a tombstone only for synced lists', () => {
  const s = { ...emptyState(), lists: { L1: L('Polity', ['upsc-2019-7'], 'R1'), L2: L('Maps') } };
  const a = deleteList(s, 'L1');
  assert.equal('L1' in a.lists, false);
  assert.deepEqual(a.deletedLists, ['R1']);
  const b = deleteList(a, 'L2');
  assert.deepEqual(b.deletedLists, ['R1']);
  assert.equal(deleteList(b, 'gone'), b);
});

test('a tombstoned set is deleted, not adopted, and its local copy is dropped', () => {
  const r = mergeLists({ L9: L('Old', [], 'R1') }, [{ id: 'R1', name: 'Old' }, { id: 'R2', name: 'Kept' }], [], ['R1', 'R3']);
  assert.deepEqual(r.deleteSets, ['R1']); // R3 is already gone from the account
  assert.equal(Object.values(r.lists).some((l) => l.remoteId === 'R1'), false);
  assert.equal(r.lists.R2.name, 'Kept');
});

test('a rename here is pushed; a rename elsewhere is adopted', () => {
  const here = mergeLists({ L1: L('New', [], 'R1', [], 'Old') }, [{ id: 'R1', name: 'Old' }], []);
  assert.deepEqual(here.renameSets, [{ listId: 'L1', name: 'New' }]);
  assert.equal(here.lists.L1.syncedName, 'New');
  const there = mergeLists({ L1: L('Old', [], 'R1', [], 'Old') }, [{ id: 'R1', name: 'Theirs' }], []);
  assert.deepEqual(there.renameSets, []);
  assert.deepEqual([there.lists.L1.name, there.lists.L1.syncedName], ['Theirs', 'Theirs']);
});

test('a list made before signing in joins an account list whose name differs only in capitals', () => {
  const r = mergeLists({ L1: L('polity', ['upsc-2019-7']) }, [{ id: 'R1', name: 'Polity' }], []);
  assert.deepEqual(r.createSets, []);
  assert.equal(r.lists.L1.remoteId, 'R1');
  assert.equal(r.lists.L1.name, 'Polity');
});

test('settle keeps a rename and a deletion made while the run was in flight', () => {
  const snapshot = { L1: L('A', [], 'R1'), L2: L('B', [], 'R2') };
  const current = { L1: L('A2', [], 'R1', [], 'A') }; // L1 renamed, L2 deleted mid-run
  const merged = { L1: L('A', [], 'R1'), L2: L('B', [], 'R2') };
  const out = settleLists(snapshot, current, merged);
  assert.equal(out.L1.name, 'A2');
  assert.equal(out.L1.syncedName, 'A');
  assert.equal('L2' in out, false);
});

test('settleTombstones clears what the run handled and keeps tombstones added during it', () => {
  assert.deepEqual(settleTombstones(['R1'], ['R1', 'R2']), ['R2']);
});
```

Add to `site/tests/progress-store.test.js`:

```js
test('parseState defaults syncedName and deletedLists for data saved before them', () => {
  const s = parseState(JSON.stringify({ entries: {}, pending: [], lists: {
    A: { name: 'Synced', keys: [], remoteId: 'R1', syncedKeys: [] },
    B: { name: 'Local', keys: [], remoteId: null, syncedKeys: [] },
  } }));
  assert.equal(s.lists.A.syncedName, 'Synced');
  assert.equal(s.lists.B.syncedName, null);
  assert.deepEqual(s.deletedLists, []);
});

test('parseState keeps only string tombstones and drops a list with a bad syncedName', () => {
  const s = parseState(JSON.stringify({ entries: {}, pending: [], deletedLists: ['R1', 7, null], lists: {
    A: { name: 'X', keys: [], remoteId: 'R1', syncedKeys: [], syncedName: 5 },
  } }));
  assert.deepEqual(s.deletedLists, ['R1']);
  assert.equal('A' in s.lists, false);
});
```

Add to `site/tests/merge.test.js`:

```js
test('rebasing for a new account clears the previous account\'s tombstones', () => {
  const out = rebaseForNewAccount({ entries: {}, pending: [], lists: {}, deletedLists: ['R1'] });
  assert.deepEqual(out.deletedLists, []);
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `node --test tests/lists.test.js tests/progress-store.test.js tests/merge.test.js` from `site/`. Expect failures for the missing exports and fields.
- [ ] **Step 3: Implement** the interfaces above in `lists.js`, `progress-store.js` and `merge.js`.
  - Keep `lists.js` import-free.
  - Update every place that builds a merged list (`finish`, adopt, fold) to set `syncedName`.
  - Update the existing tests whose expected objects now need `syncedName`.
- [ ] **Step 4: Run the full suite.** `npm test` must be all green, with pristine output.
- [ ] **Step 5: Commit.** `feat(site): lists can be renamed and deleted, and names ignore capitals`

---

### Task 2: List sync: delete sets, rename sets, and tombstones

**Files:**
- Modify: `site/src/scripts/sync-lists.js`
- Test: `site/tests/sync.test.js`, extending `fakeClient` with `bookmark_sets` UPDATE and DELETE

**Interfaces:**
- **Consumes (Task 1):** `mergeLists(localLists, remoteSets, remoteBookmarks, deletedLists)` → `{ …, renameSets, deleteSets }`, `settleLists`, `settleTombstones`, `isDirty`, and the state's `deletedLists`.
- **Produces:** `syncLists(client, user, { full })` behaves as below. The signature is unchanged.

**Behaviour, all inside the existing function:**
- **When it runs.**
  - The lists step runs when `full`, or any list `isDirty`, or `snapshot.deletedLists.length > 0`. The snapshot is `loadState()` at start.
  - Merge with `snapshot.deletedLists`.
- **Writes, in order. Any error throws and nothing is saved.**
  1. **Delete sets.** For `deleteSets` in chunks of 100, call `client.from('bookmark_sets').delete().eq('user_id', user.id).in('id', chunk)`. Bookmarks go by the database cascade.
  2. **Create sets.** Unchanged.
  3. **Rename sets.** For each `renameSets` entry, call `client.from('bookmark_sets').update({ name }).eq('id', lists[listId].remoteId).eq('user_id', user.id)`.
     - If the error's `code === '23505'` (unique violation: the account already has that name), do not throw. Set `lists[listId].name` and `syncedName` back to the account's current name for that set (from the pulled `sets`), and continue.
     - Any other error throws.
  4. **Add bookmarks.** Unchanged.
  5. **Delete bookmarks.** Unchanged.
- **Settle.**
  - `const current = loadState()`.
  - `lists = settleLists(snapshot.lists, current.lists, merged.lists)`.
  - `deletedLists = settleTombstones(snapshot.deletedLists, current.deletedLists)`.
  - `changed` is true when the lists differ (`listsEqual`) or the tombstone arrays differ.
  - Save `{ ...current, lists, deletedLists }` when changed. Throw if the save fails.
  - Then, as now: `deviceOwner.remember`, `listsPull.remember` when full, and `sawaalbox:synced` when changed.

- [ ] **Step 1: Extend the fake client.**
  - `bookmark_sets` supports `.update(values).eq().eq()`. It enforces case-sensitive `unique(user_id, name)` by returning `{ error: { code: '23505', message: 'duplicate key' } }`.
  - It supports `.delete().eq('user_id').in('id', ids)`, cascading to bookmarks of those sets.
  - It asserts `user_id` on every write, as the existing fake does.
- [ ] **Step 2: Write failing tests** in `sync.test.js`. Use the existing helpers and the two-device pattern already in the file.
  - A list renamed on this device is renamed on the account. A second device's next full pull shows the new name, with `syncedName` equal to it.
  - A list deleted on this device:
    - deletes the account set and its bookmarks
    - clears the tombstone after the run
    - is not adopted back by the next full pull
  - **Delete made offline.** The first run fails (network error). Then a full pull while still tombstoned must not resurrect the list, and the next successful run deletes it.
  - **Delete on another device.** The list disappears here on the next full pull.
  - **Rename refused by the account.** Device B created "Maps" since A's last pull; A renames "Polity" to "Maps". The run does not throw. A's list reverts to the account's name ("Polity") with `syncedName` "Polity", and the next run is not blocked.
  - **Mid-run changes.** A rename and a delete made while a run awaits the network (use `slowNetwork`) survive the run. The next run pushes them.
  - **Push order.** For a run that deletes set R1, creates "New", renames R2 and adds a bookmark, assert the order of calls: delete-set before insert, before update, before bookmark upsert.
  - **No-op.** A clean targeted run with no tombstones, no dirty lists and a fresh lists marker makes zero list requests.
- [ ] **Step 3: Confirm they fail, then implement** the behaviour in `sync-lists.js`.
- [ ] **Step 4: Run** `npm test`. Everything passes, with pristine output.
- [ ] **Step 5: Commit.** `feat(site): renamed and deleted lists reach the account and every device`

---

### Task 3: Header: "My progress" link and the "My account" menu

**Files:**
- Modify: `site/src/components/Masthead.astro`, `site/src/pages/index.astro`, `site/src/pages/upsc/index.astro`, `site/src/components/AccountControl.astro`, `site/src/scripts/account.js`

**Interfaces:**
- **Consumes:** `initialOf(user)` from `auth.js`, `show(user)` and `endSession()` in `account.js`, and the `data-auth` attribute (in/out).
- **Produces:**
  - A server-rendered `<a href="/account" class="nav-progress">My progress</a>` in every header nav.
  - A `[data-account-name]` text node filled by `show(user)`.

**Markup and behaviour (spec section 1):**
- **"My progress" link.**
  - **Placement:**
    - Masthead: after Search, or first when there is no exam.
    - Homepage mast: after "What's inside".
    - /upsc cover mast: in `.mast-actions`, before `<AccountControl />`.
  - It is always rendered, whatever the flag and whether signed in or out.
  - Use the nav's existing link styles so it reads like "Exams" and "Subjects".
  - Mark it `aria-current="page"` on `/account`.
- **AccountControl, signed in.** The toggle button contains:
  - `<span data-account-initial>`
  - `<span class="account-label">My account</span>`
  - `<span class="account-caret" aria-hidden="true"></span>`, drawn in CSS with a border-rotated square or similar, never a text character
  - It keeps `aria-controls`, `aria-expanded` and the visually hidden text "Your account" (the label provides it).
- **The panel, `#account-menu`, in order:**
  - `<p class="account-who">Signed in as <span data-account-name></span></p>`
  - `<a href="/account">My progress</a>`
  - `<a href="/account#lists">My lists</a>`
  - the existing Sign out button, keeping its busy behaviour
- **`show(user)`** sets `[data-account-name]` text to `user.user_metadata?.full_name?.trim() || user.email || ''` using `textContent`.
- **Phones.** Below a width breakpoint, `.account-label` becomes visually hidden (not `display:none`; the accessible name stays). Choose the breakpoint by measuring so the header stays one row at 360px with "My progress" present, signed in and out.
  - Reserve the control's width under `@media (scripting: enabled)` as today, re-measured for the new content, so CLS is 0 when Sign in or My account appears.
  - The homepage mast and the /upsc cover mast must also stay tidy. The /upsc cover already moves its actions to their own row below 40rem; keep that working.
- **Clicking "My lists" on /account itself** must scroll to `#lists`. A plain anchor does this; no script is needed.

- [ ] **Step 1: Implement** the markup and CSS. Use DESIGN.md tokens only.
- [ ] **Step 2: Build** (flag on is the default) and run `node scripts/check-links.mjs`. `/account` is linked from every page now, so the link check covers it.
- [ ] **Step 3: Headless checks** on the production build.
  - Measure CLS at 360, 390 and 1280px on `/`, `/upsc`, `/upsc/subjects` and `/account`: signed out (no session), and signed in, with a fake stored session as in earlier tasks' scripts, which stubs the client.
  - Check the panel opens and closes with click, Escape and Tab-out, and that focus returns to the toggle.
  - Check accessible names: the toggle is "My account" (or "Your account"), and "My progress" is a link.
  - Take screenshots, light and dark, at 390px and 1280px, of the header signed out, signed in, and with the panel open, saved as `sx-header-*.png`.
- [ ] **Step 4: Run the detector** on the changed files, then `npm test`.
- [ ] **Step 5: Commit.** `feat(site): a My progress link in every header and a labelled account menu`

---

### Task 4: /account: Needs review and list cards, Rename and Delete

**Files:**
- Modify: `site/src/lib/accounts/summary.js`, `site/src/pages/account.astro`, `site/src/scripts/progress-page.js`
- Test: `site/tests/summary.test.js`

**Interfaces:**
- **Consumes (Task 1):** `renameList`, `deleteList`, `findByName`. It also consumes `summarise`, `describe`, `indexPathsFor` and `pendingPaths` (existing), and the page's existing `load`, `say`, `captureFocus` and `restoreFocus`.
- **Produces:**
  - `subjectsCovered(keys: string[], index): { top: string[], more: number }`. Subjects of the known keys, counted. `top` is the two most frequent, ties broken A–Z, and `more` is the count of other distinct subjects. Unknown keys are ignored.
  - `reviewOldestFirst(state): string[]`. Keys with status `review`, oldest `updatedAt` first, ties broken by key.
  - Revise links: `/revise?review` and `/revise?list=${encodeURIComponent(id)}`.

- [ ] **Step 1: Write failing tests** in `summary.test.js`.

```js
test('subjectsCovered names the two most frequent subjects and counts the rest', () => {
  const index = {
    'upsc-2019-1': ['/upsc/question/a', 'Polity', 't'], 'upsc-2019-2': ['/upsc/question/b', 'Polity', 't'],
    'upsc-2019-3': ['/upsc/question/c', 'Economy', 't'], 'upsc-2019-4': ['/upsc/question/d', 'Geography', 't'],
    'upsc-2019-5': ['/upsc/question/e', 'Art & Culture', 't'],
  };
  assert.deepEqual(subjectsCovered(['upsc-2019-1', 'upsc-2019-2', 'upsc-2019-3', 'upsc-2019-4', 'upsc-2019-5', 'upsc-2019-9'], index),
    { top: ['Polity', 'Art & Culture'], more: 2 });
  assert.deepEqual(subjectsCovered([], index), { top: [], more: 0 });
});

test('reviewOldestFirst orders needs-review marks oldest first', () => {
  const state = { entries: {
    'upsc-2019-1': { status: 'review', updatedAt: '2026-10-03T00:00:00Z' },
    'upsc-2019-2': { status: 'done', updatedAt: '2026-10-01T00:00:00Z' },
    'upsc-2019-3': { status: 'review', updatedAt: '2026-10-01T00:00:00Z' },
  }, lists: {} };
  assert.deepEqual(reviewOldestFirst(state), ['upsc-2019-3', 'upsc-2019-1']);
});
```

- [ ] **Step 2: Implement** the two pure helpers. Confirm the tests pass.
- [ ] **Step 3: Rework the page (spec section 2).**
  - **Markup.** The lists section gets `id="lists"`. The Needs review section and the lists become a single "Revision" area, with the Needs review card first, then the list cards A–Z.
  - **Card markup** (built with `el` and `text`, never `innerHTML` for data):
    - `<article class="acct-card">`
    - `<h3>`: the name, or "Needs review"
    - the count, `{n} question(s)`
    - the subjects line: `Polity · Economy · +2 more`, omitted when empty
    - **Revise**, an outlined link button, omitted for an empty list
    - text buttons **Rename** and **Delete**, on list cards only
    - Empty list text: "No questions yet: use Save to list on any question."
    - Empty Needs review text: "Nothing marked for review."
  - **Rename flow.**
    - The heading is replaced in place by `<label class="visually-hidden">List name</label><input maxlength=80>` with **Save** and **Cancel**. Escape cancels.
    - Save calls `renameList(loadState(), id, value)`. On a thrown message, call `setCustomValidity`, then `reportValidity`, and announce the message through the lists note.
    - On success, save state (the "would not save" note on failure, as today), dispatch `sawaalbox:list` with `{ listId: id }`, re-render, and return focus to the Rename button.
  - **Delete flow.**
    - An inline confirm inside the card: `Delete "{name}" and its {n} saved questions? This removes it on all your devices.` with **Delete list** and **Cancel**. Focus goes to Cancel, and Escape cancels.
    - Confirm calls `deleteList`, saves, dispatches `sawaalbox:list` with `{ listId: id }`, re-renders, announces `Deleted "{name}".`, and focuses the lists heading.
  - **Removed.** The inline question rows on /account go: the old `item`, `itemList` and `drawReview` per-question rows, and the Remove buttons. Removing a question from a list now lives on /revise (Task 6). Delete the dead code and its CSS.
  - **Kept.** The index loading, the "By subject" table and the status line. Subjects covered need the index, so a card shows its subjects line only once that list's year files have loaded. The line's space is reserved so the card doesn't grow.
- [ ] **Step 4: Headless checks.**
  - Seed lists, including "test" and "Test" and an empty one.
  - Check the cards, Revise hrefs, the rename success and duplicate error, delete confirm and cancel, focus, and announcements.
  - Check "My lists" from the header lands at `#lists`.
  - Check CLS at 360 and 390px.
  - Take screenshots, light and dark, saved as `sx-account-*.png`.
- [ ] **Step 5: Run** the detector, `npm test`, the build and check-links.
- [ ] **Step 6: Commit.** `feat(site): progress page shows lists as cards you can revise, rename and delete`

---

### Task 5: Shared question renderer and per-year full-question files

**Files:**
- Create: `site/src/lib/question-html.js`, `site/src/pages/upsc/full/[year].json.js`
- Modify: `site/src/pages/upsc/search.astro`
- Test: `site/tests/question-html.test.js`

**Interfaces:**
- **Produces:**
  - `questionHTML(q): string`, moved verbatim from `search.astro`, together with its helpers `esc`, `slugify`, `ALIASES` and `canonical`.
    - Input shape: `{ year, q_no, subject, subtopic, difficulty, question, a, b, c, d, answer, answer_note, status }`. That is the search API's result shape, and the file entry shape below.
    - Output: the existing `<article class="qblock" data-qkey=…>` markup with an empty `.qmarks` slot.
    - It is pure: no DOM.
    - Export `esc` too.
  - `/upsc/full/{year}.json`: `{ [qkey]: { year, q_no, subject, subtopic, difficulty, question, a, b, c, d, answer, answer_note, status } }`.
    - Built with `getStaticPaths` over `YEARS` from `lib/corpus.js`.
    - It uses the corpus question objects, with the subject already canonical. Do **not** include `id`, `slug` or other fields.
    - Measured sizes are about 64 KB raw and about 16 KB gzip on average, 21 KB at most.

- [ ] **Step 1: Write the failing test.**
  - Capture the current output of `questionHTML` for three fixture results before moving anything: a normal question, a cancelled question with no answer, and a disputed one with `answer_note`. Run the existing function in a scratch harness.
  - Write `tests/question-html.test.js` asserting the moved function produces exactly those strings.
- [ ] **Step 2: Move the function.**
  - Create `lib/question-html.js` and make `search.astro`'s script import it.
  - The search script is a `define:vars` inline script today. Split it: keep `define:vars` only for `API_BASE`, and move the logic into a bundled `<script>` that imports `../../lib/question-html.js` and reads `API_BASE` from a `data-api-base` attribute on the form.
  - Search behaviour must be identical: wake ping, slow notice, paging, URL state.
  - Run the test.
- [ ] **Step 3: Add the endpoint.**
  - Build, then check that `dist/upsc/full/2019.json` has `upsc-2019-7` with all 13 fields.
  - Record the raw and gzip sizes of every year file in the report.
- [ ] **Step 4: Browser check.** Use a headless browser against the built `/upsc/search` with the live API: a search renders results identical to before, with marks controls present.
- [ ] **Step 5: Checks.** `npm test`, the build, check-links.
- [ ] **Step 6: Commit.** `refactor(site): one question renderer for search and revision, with per-year question files`

---

### Task 6: The revise page

**Files:**
- Create: `site/src/pages/revise.astro`, `site/src/scripts/revise-page.js`
- Modify: `site/src/lib/accounts/summary.js` to add a pure `fullPathsFor(keys)`
- Test: `site/tests/summary.test.js`

**Interfaces:**
- **Consumes:**
  - `questionHTML` (Task 5)
  - `reviewOldestFirst` and `subjectsCovered` (Task 4)
  - `removeKey`
  - `loadState`, `saveState`
  - `parseKey` and `serialOf` from `summary.js`
  - `/{exam}/full/{year}.json` (Task 5)
- **Produces:**
  - `fullPathsFor(keys: string[]): string[]`. The sorted, unique `/${exam}/full/${year}.json` paths for valid keys.

- [ ] **Step 1: Write the failing test.**

```js
test('fullPathsFor asks for one file per exam and year, in order', () => {
  assert.deepEqual(fullPathsFor(['upsc-2019-7', 'upsc-2001-3', 'upsc-2019-9', 'junk']), ['/upsc/full/2001.json', '/upsc/full/2019.json']);
});
```

- [ ] **Step 2: Implement `fullPathsFor`** and confirm the test passes.
- [ ] **Step 3: Write the page (spec section 3).**
  - **`revise.astro`:**
    - Layout: `Document` with `noindex`, `Masthead`, `Colophon`.
    - `<main class="sheet revise">` contains the header area (`h1`, a count and subjects line, and a "Back to your progress" link to `/account#lists`), a `role="status"` note, and an empty `#revise-items`.
    - A `<noscript>` line: "Revising a list needs JavaScript."
    - Import `../scripts/marks.js` the same way question pages do, so the injected blocks get Mark done, Needs review and Save to list through its MutationObserver. Check how `QuestionBlock.astro` loads it, and reuse that exact import so it is one module instance.
    - Do not add the page to the sitemap.
  - **`revise-page.js`:**
    - **Parse `location.search`.** `review` (present) selects Needs review. Otherwise `list=<id>` must name a list in `loadState().lists`. Anything else shows "This list isn't on this device." with a link to Your progress.
    - **Keys.** A list uses `list.keys` in saved order. Needs review uses `reviewOldestFirst(state)`, captured once at load, so marking Done does not drop a question mid-session.
    - **Loading.** Fetch `fullPathsFor(keys)` in parallel with `AbortSignal.timeout(15000)`. On the `online` event, retry failed years.
      - While loading, show "Loading {n} questions…".
      - A failed year shows "Couldn't load questions from {year}." with a **Try again** button that refetches that year.
      - Validate each entry's shape (13 fields, strings or numbers as expected) before rendering. Skip malformed entries and show their serials.
    - **Rendering.** Insert `questionHTML(entry)` for the first 20 keys into `#revise-items`.
      - **List mode.** After each block, add a **Remove from this list** text button. It calls `removeKey`, saves (the "would not save" note on failure), dispatches `sawaalbox:list` with `{ listId }`, removes the block, updates the count, announces `Removed from "{name}".`, and moves focus to the next block's heading, or the page heading if there are none.
      - **Show 20 more** appends the next 20 and focuses the first new block's question link.
      - Keys whose year is still loading render as placeholder blocks with a reserved height, so nothing shifts.
      - A key absent from a loaded file shows as its serial in a small note row.
    - **Empty states.** An empty list reads "No questions yet: use Save to list on any question." Needs review with nothing reads "Nothing marked for review."
    - **Header.** The title is the list name or "Needs review". The count is `{n} question(s)`. The subjects line uses `subjectsCovered` on the loaded entries; build a `{ [key]: [path, subject, title] }` view from the full entries, or reuse the per-year index loader.
    - **Sync.** Nothing extra. The page loads `AccountControl` via `Masthead`, which already runs the normal sync when signed in.
    - **Re-reading storage.** Re-read storage on the `storage` event and on `sawaalbox:synced`. If the list was deleted or renamed elsewhere, update the title, or show "This list isn't on this device."
- [ ] **Step 4: Headless checks** on the build.
  - Cover: a list with 25 questions across 3 years (only those 3 files fetched; Show 20 more works), Needs review, an empty list, an unknown id, and a forced year failure with Try again.
  - Check Remove from this list (count, announcement, focus).
  - Check that Mark done on a needs-review question keeps it on the page.
  - Check answers are hidden until Show answer.
  - Check CLS at 390px.
  - Check accessible names.
  - Take screenshots, light and dark, at 390px and 1280px, saved as `sx-revise-*.png`.
- [ ] **Step 5: Run** the detector, `npm test`, the build and check-links.
- [ ] **Step 6: Commit.** `feat(site): a revise page that opens any list or the needs-review pile in full`

---

## Self-review (writer's checklist, done)

- **Spec coverage:**
  - Header (Task 3).
  - Overview, rename, delete and near-duplicates (Tasks 1, 2 and 4).
  - State shape (Task 1).
  - Sync order and settle (Task 2).
  - Revise page and data files (Tasks 5 and 6).
  - Global constraints (here).
  - Testing (each task).
  - Non-goals are not built.
- **Names used across tasks:**
  - `renameList`, `deleteList`, `findByName`, `sameName`, `settleTombstones`
  - `syncedName`, `deletedLists`
  - `subjectsCovered`, `reviewOldestFirst`, `fullPathsFor`
  - `questionHTML`
  - `/upsc/full/{year}.json`, `/revise?list=` / `?review`
