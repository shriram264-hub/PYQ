import { authEnabled } from '../lib/accounts/config.js';
import { STORAGE_KEY, loadState, saveState } from '../lib/accounts/progress-store.js';
import { removeKey } from '../lib/accounts/lists.js';
import { describe, indexPathsFor, summarise } from '../lib/accounts/summary.js';
// auth.js fetches supabase-js only when signIn() runs, so importing it costs
// signed-out visitors no more than its own few lines.
import { mayHaveSession, signIn } from './auth.js';

// The /account page. Everything it shows comes from this device's storage (a
// sync keeps that in step with the account), plus the per-year question indexes
// that turn stored keys back into subjects, titles and links.

const NOT_SAVED = 'Your browser would not save that. Check that it lets this site store data.';
const SIGN_IN_FAILED = 'Could not reach the sign-in service. Your progress on this device is safe.';

const WHERE = {
  device: 'Kept on this device.',
  out: 'Kept on this device. An account keeps your progress and lists on every device.',
  in: 'Signed in. Your progress and lists sync to your account.',
};

const $ = (selector) => document.querySelector(selector);
const summaryBox = $('[data-summary]');
const reviewBox = $('[data-review]');
const listsBox = $('[data-lists]');
const listsNote = $('[data-lists-note]');
const whereNote = $('[data-where-note]');

const el = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
};
// Everything below is built with textContent, never an HTML string: a list name
// is the student's text, and markup in it must stay inert.
const text = (tag, className, value) => el(tag, className, value);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// A live region that is always in the page. A failure is shown as well as
// announced (see .acct-note).
function say(note, message, { error = false } = {}) {
  note.textContent = message;
  note.toggleAttribute('data-error', error && Boolean(message));
}

// --- The question indexes. ---

const index = {}; // every key loaded so far -> [path, subject, title]
const requests = new Map(); // index path -> 'loading' | 'loaded' | 'failed'

async function load(path) {
  requests.set(path, 'loading');
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(String(response.status));
    Object.assign(index, await response.json());
    requests.set(path, 'loaded');
  } catch {
    // Offline, or a year that is not there. Those keys show as keys.
    requests.set(path, 'failed');
  }
}

// --- Drawing. ---

// Drawing replaces the page's lists wholesale, so a focused link or button
// would be lost to <body> and a keyboard user sent back to the top. Remember
// the control, then focus the same one again, else its neighbour (Remove takes
// the question out from under the cursor), else the heading of its group.
function captureFocus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.dataset.fid) return null;
  const group = active.closest('[data-scope]');
  if (!group) return null;
  const same = [...group.querySelectorAll(`[data-kind="${active.dataset.kind}"]`)];
  return { fid: active.dataset.fid, scope: group.dataset.scope, kind: active.dataset.kind, at: same.indexOf(active) };
}

function restoreFocus(before) {
  if (!before) return;
  const exact = [...document.querySelectorAll('[data-fid]')].find((n) => n.dataset.fid === before.fid);
  if (exact) return exact.focus();
  const group = [...document.querySelectorAll('[data-scope]')].find((n) => n.dataset.scope === before.scope);
  if (!group) {
    // The whole group went (its list was dropped, or the last review mark was
    // cleared): the section's heading is the nearest place left.
    document.getElementById(before.scope === 'review' ? 'acct-rev-h' : 'acct-lists-h')?.focus();
    return;
  }
  const same = [...group.querySelectorAll(`[data-kind="${before.kind}"]`)];
  (same[Math.min(before.at, same.length - 1)] ?? group.querySelector('[data-kind="head"]'))?.focus();
}

// A question as one row: its serial, and its title as a link. Rows are not
// links as a whole (the Remove button lives in one). A key the index does not
// know has no title to show and no page to link to, so it is shown as the key.
function item({ scope, key, from }) {
  const q = describe(key, index);
  const li = el('li', 'acct-item');
  if (q.path) {
    const ref = text('span', 'serial acct-ref', q.serial);
    const link = text('a', '', q.title);
    link.href = q.path;
    link.dataset.fid = `link|${scope}|${key}`;
    link.dataset.kind = 'link';
    li.append(ref, el('span', 'acct-q', link));
  } else {
    const ref = text('span', 'serial acct-ref', key);
    ref.dataset.unplaced = '';
    li.append(ref);
  }
  if (from) {
    const button = text('button', 'acct-remove', 'Remove');
    button.type = 'button';
    button.dataset.list = from.id;
    button.dataset.key = key;
    button.dataset.fid = `remove|${scope}|${key}`;
    button.dataset.kind = 'remove';
    // The visible word is "Remove": the name starts with it and then says what
    // goes and from where, because a page of Removes is otherwise a page of
    // identical buttons.
    const what = q.path ? `"${q.title}" (${q.serial})` : key;
    button.setAttribute('aria-label', `Remove ${what} from "${from.name}"`);
    li.append(button);
  }
  return li;
}

function drawSummary(view, settled) {
  const { totals, subjects, unplaced } = view;
  const marked = totals.done + totals.review;
  if (!marked) {
    const link = text('a', '', 'any question');
    link.href = '/upsc';
    summaryBox.replaceChildren(el('p', 'acct-empty', 'Nothing marked yet: use Mark done or Needs review on ', link, '.'));
    return;
  }
  // Subjects need the indexes. Counting by subject before they have arrived
  // would put every question in a made-up bucket, so wait for them.
  if (!settled) {
    summaryBox.replaceChildren(text('p', 'acct-empty', 'Loading subjects.'));
    return;
  }
  if (!subjects.length) {
    summaryBox.replaceChildren(
      text(
        'p',
        'acct-empty',
        `The subjects of your ${plural(marked, 'marked question', 'marked questions')} did not load. If you were offline, reload to try again.`
      )
    );
    return;
  }

  const cell = (tag, className, value, scope) => {
    const c = text(tag, className, String(value));
    if (scope) c.scope = scope;
    return c;
  };
  const row = (name, done, review) =>
    el('tr', '', cell('th', '', name, 'row'), cell('td', 'acct-num', done), cell('td', 'acct-num', review));
  const head = el(
    'tr',
    '',
    cell('th', '', 'Subject', 'col'),
    cell('th', 'acct-num', 'Done', 'col'),
    cell('th', 'acct-num', 'Needs review', 'col')
  );
  const table = el(
    'table',
    'acct-table',
    el('thead', '', head),
    el('tbody', '', ...subjects.map((s) => row(s.subject, s.done, s.review))),
    el('tfoot', '', row('Total', totals.done, totals.review))
  );
  table.setAttribute('aria-labelledby', 'acct-sum-h');
  summaryBox.replaceChildren(table);
  if (unplaced) {
    summaryBox.append(
      text(
        'p',
        'acct-after',
        `${plural(unplaced, 'marked question', 'marked questions')} could not be matched to a subject, so ${
          unplaced === 1 ? 'it is' : 'they are'
        } in the total only. If you were offline, reload to try again.`
      )
    );
  }
}

function drawReview(view) {
  if (!view.review.length) {
    reviewBox.replaceChildren(text('p', 'acct-empty', 'Nothing is marked Needs review.'));
    return;
  }
  const list = el('ol', 'acct-items', ...view.review.map((key) => item({ scope: 'review', key })));
  list.dataset.scope = 'review';
  reviewBox.replaceChildren(list);
}

function drawLists(view) {
  if (!view.lists.length) {
    listsBox.replaceChildren(text('p', 'acct-empty', 'No lists yet: use Save to list on any question.'));
    return;
  }
  const sets = view.lists.map((l) => {
    const heading = text('h3', '', l.name);
    heading.tabIndex = -1;
    heading.dataset.fid = `head|${l.id}`;
    heading.dataset.kind = 'head';
    const set = el(
      'section',
      'acct-set',
      el('div', 'acct-set-head', heading, text('p', 'acct-count', plural(l.keys.length, 'question', 'questions')))
    );
    set.dataset.scope = l.id;
    if (l.keys.length) {
      set.append(el('ol', 'acct-items', ...l.keys.map((key) => item({ scope: l.id, key, from: l }))));
    } else {
      set.append(text('p', 'acct-empty', 'No questions in this list yet: use Save to list on any question.'));
    }
    return set;
  });
  listsBox.replaceChildren(el('div', 'acct-lists', ...sets));
}

function render(state = loadState()) {
  const before = captureFocus();
  const view = summarise(state, index);
  // Settled: every index this state needs has either arrived or failed.
  const settled = indexPathsFor(state).every((p) => requests.get(p) === 'loaded' || requests.get(p) === 'failed');
  drawSummary(view, settled);
  drawReview(view);
  drawLists(view);
  restoreFocus(before);
}

// Draw now with what is known, fetch the years not yet asked for, draw again.
// A student who has marked nothing fetches nothing.
async function refresh() {
  const state = loadState();
  const fresh = indexPathsFor(state).filter((p) => !requests.has(p));
  render(state);
  if (!fresh.length) return;
  await Promise.all(fresh.map(load));
  render();
}

// --- Remove. ---

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('.acct-remove');
  if (!button) return;
  const { list: listId, key } = button.dataset;
  const before = loadState();
  const name = before.lists[listId]?.name;
  const what = describe(key, index).serial;
  // removeKey, not a toggle: this page may be stale, and a toggle would put
  // back a question another tab has already removed.
  const next = removeKey(before, listId, key);
  if (next === before) {
    // Already gone (another tab, or a sync): nothing to write or announce to
    // the sync, just show the truth.
    say(listsNote, name ? `${what} was already removed from "${name}".` : 'That list is already gone.');
    render(before);
    return;
  }
  if (!saveState(next)) {
    say(listsNote, NOT_SAVED, { error: true });
    return;
  }
  say(listsNote, `Removed ${what} from "${name}".`);
  document.dispatchEvent(new CustomEvent('sawaalbox:list', { detail: { listId, key, added: false } }));
  render(next);
});

// --- Where it is kept. ---

const signin = $('[data-signin]');
const where = $('[data-where]');

function showWhere(mode) {
  where.textContent = WHERE[mode];
  if (signin) signin.hidden = mode !== 'out';
}

// Dark launch: authEnabled is false, so nothing below runs and the page says
// only what the server wrote, "Kept on this device."
if (authEnabled) {
  signin.addEventListener('click', () => {
    say(whereNote, '');
    signIn().catch(() => say(whereNote, SIGN_IN_FAILED, { error: true }));
  });
  document.addEventListener('sawaalbox:signed-in', () => showWhere('in'));
  document.addEventListener('sawaalbox:signed-out', () => showWhere('out'));
  // No stored session and no sign-in on its way back: signed out, and we know
  // it without loading supabase-js. With a session we wait for the event, so a
  // signed-in student never sees an offer to sign in.
  if (!mayHaveSession()) showWhere('out');
}

// A sync that lands brings the account's marks and lists, and possibly years
// this page has not fetched. Other tabs and a restored page change storage too.
document.addEventListener('sawaalbox:synced', refresh);
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) refresh();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) refresh();
});

refresh();
