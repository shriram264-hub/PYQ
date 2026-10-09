import {
  SUPABASE_URL,
  authEnabled,
  firstSyncHere,
  sessionHint,
  storageKeyFor,
  storedUserId,
} from '../lib/accounts/config.js';
import { deviceOwner } from '../lib/accounts/pull.js';
import { STORAGE_KEY, loadState, saveState } from '../lib/accounts/progress-store.js';
import { deleteList, renameList } from '../lib/accounts/lists.js';
import {
  indexPathsFor,
  pendingForKeys,
  pendingPaths,
  subjectsCovered,
  summarise,
} from '../lib/accounts/summary.js';

// The /account page. Everything it shows comes from this device's storage (a
// sync keeps that in step with the account), plus the per-year question indexes
// that turn stored keys back into subjects.
//
// No auth code is imported here: until sign-in is switched on this page must
// not carry any, so Sign in loads auth.js (and through it supabase-js) when it
// is pressed, and the state of the session is read off the masthead control.

const NOT_SAVED = 'Your browser would not save that. Check that it lets this site store data.';
const SIGN_IN_FAILED = 'Could not reach the sign-in service. Your progress on this device is safe.';
// How long one year's index may take. Past this the year counts as failed (its
// subjects are left out) rather than leaving "Loading subjects." up for ever on
// a connection that has stalled.
const INDEX_TIMEOUT_MS = 15000;

// The line the server writes is the dark-launch one, "Kept on this device.".
const WHERE = {
  out: 'Kept on this device. An account keeps your progress and lists on every device.',
  in: 'Signed in. Your progress and lists sync to your account.',
};

const $ = (selector) => document.querySelector(selector);
const acct = $('.acct');
const summaryBox = $('[data-summary]');
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
    // The signal covers reading the body as well as the first byte.
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(INDEX_TIMEOUT_MS) : undefined;
    const response = await fetch(path, { signal });
    if (!response.ok) throw new Error(String(response.status));
    Object.assign(index, await response.json());
    requests.set(path, 'loaded');
  } catch {
    // Offline, too slow, or a year that is not there. Those keys get no subject.
    requests.set(path, 'failed');
  }
}

// --- Drawing. ---

// What the person has open on a card. Drawing replaces the cards wholesale (a
// sync or a year arriving redraws them), so it is kept here and not on the
// nodes: the name being typed, and the list waiting on a Delete confirmation.
const ui = {
  // { id, value, error }: the list being renamed, the name as typed so far, and
  // what is wrong with it ('' for nothing). The error stays until the next edit.
  edit: null,
  confirm: null, // the id of the list whose Delete is waiting for a yes
};

// The Needs review card's id for focus: not a list's, whatever a list is called.
const REVIEW_ID = '__review__';
const EDIT_INPUT = 'acct-edit-input';
const EDIT_ERROR = 'acct-edit-error';
const CONFIRM_TEXT = 'acct-confirm-text';
const LISTS_HEADING = 'acct-lists-h';

// Drawing replaces the page's cards wholesale, so a focused link or button
// would be lost to <body> and a keyboard user sent back to the top. Remember
// the control, then focus the same one again, else its card's heading, else the
// heading of the area. A caret in the name being typed is put back as well.
function captureFocus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.dataset.fid) return null;
  return {
    fid: active.dataset.fid,
    scope: active.closest('[data-scope]')?.dataset.scope ?? null,
    caret: active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] : null,
  };
}

const byFid = (fid) => [...document.querySelectorAll('[data-fid]')].find((n) => n.dataset.fid === fid);

function restoreFocus(before) {
  if (!before) return;
  const exact = byFid(before.fid);
  if (exact) {
    exact.focus();
    if (before.caret && exact instanceof HTMLInputElement) exact.setSelectionRange(...before.caret);
    return;
  }
  // The card or the control is gone (a list was deleted, or its Delete was
  // answered): the card's heading if there is one, else the area's.
  const card = [...document.querySelectorAll('[data-scope]')].find((n) => n.dataset.scope === before.scope);
  (card?.querySelector('[data-kind="head"]') ?? document.getElementById(LISTS_HEADING))?.focus();
}

// After something the person did, focus goes where the rules below say, not
// wherever the control they used happened to be.
const focusFid = (fid) => byFid(fid)?.focus();

// A control on a card. data-act says what it does; data-fid is how focus finds
// it again after a redraw. The accessible name starts with the visible word and
// then says which list, because a page of identical "Rename" buttons is not
// something a screen reader user can tell apart.
function control(tag, className, label, { act, id, fid, aria }) {
  const node = text(tag, className, label);
  if (tag === 'button') node.type = 'button';
  if (act) node.dataset.act = act;
  node.dataset.list = id;
  node.dataset.fid = `${fid}|${id}`;
  node.dataset.kind = fid;
  if (aria) node.setAttribute('aria-label', aria);
  return node;
}

// What is wrong with the name being typed, next to the field: a line under it,
// tied to it for a screen reader, and the field marked invalid. '' clears it.
function showEditError(input, message) {
  let line = input.form?.querySelector('.acct-edit-error');
  input.setCustomValidity(message);
  if (!message) {
    line?.remove();
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    return;
  }
  if (!line) {
    line = text('p', 'acct-edit-error', '');
    line.id = EDIT_ERROR;
    input.after(line);
  }
  line.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', EDIT_ERROR);
}

// The card's count goes inside the form, after Cancel: the form takes the
// heading's place, and the count stays beside the controls, not below them.
function renameForm(id, count) {
  const input = el('input');
  input.id = EDIT_INPUT;
  input.type = 'text';
  input.maxLength = 80; // MAX_NAME (lists.js), which cleanName enforces whatever this says
  input.autocomplete = 'off';
  input.value = ui.edit.value;
  input.dataset.fid = `input|${id}`;
  input.dataset.kind = 'input';
  const label = text('label', 'visually-hidden', 'List name');
  label.htmlFor = EDIT_INPUT;
  const save = text('button', 'acct-btn', 'Save');
  save.type = 'submit';
  save.dataset.fid = `save|${id}`;
  save.dataset.kind = 'save';
  const cancel = control('button', 'acct-text-btn', 'Cancel', { act: 'cancel-edit', id, fid: 'cancel-edit' });
  const form = el('form', 'acct-edit', label, input, save, cancel, count);
  form.noValidate = true; // the message is ours, not the browser's
  form.dataset.list = id;
  if (ui.edit.error) showEditError(input, ui.edit.error);
  return form;
}

function confirmBox({ id, name, keys }) {
  const n = keys.length;
  const ask = n
    ? `Delete "${name}" and its ${plural(n, 'saved question', 'saved questions')}? This removes it on all your devices.`
    : `Delete "${name}"? This removes it on all your devices.`;
  const message = text('p', 'acct-confirm-text', ask);
  message.id = CONFIRM_TEXT;
  const yes = control('button', 'acct-btn', 'Delete list', { act: 'delete-yes', id, fid: 'delete-yes' });
  const no = control('button', 'acct-text-btn', 'Cancel', { act: 'delete-no', id, fid: 'delete-no' });
  // Focus lands on Cancel, so the question is what a screen reader says next.
  for (const b of [yes, no]) b.setAttribute('aria-describedby', CONFIRM_TEXT);
  const box = el('div', 'acct-confirm', message, yes, no);
  box.setAttribute('role', 'group');
  box.setAttribute('aria-labelledby', CONFIRM_TEXT);
  return box;
}

// "Polity · Economy · +2 more". Empty while the years this card's questions are
// in are still on their way (the line is there, so the card does not grow when
// it fills), and for questions the index does not know.
function subjectsLine(keys) {
  const line = el('p', 'acct-subjects');
  if (pendingForKeys(keys, requests).length) return line;
  const { top, more } = subjectsCovered(keys, index);
  if (!top.length) return line;
  // Two parts so a long subject gives way with an ellipsis and "+k more" stays.
  line.append(text('span', 'acct-subjects-top', top.join(' · ')));
  if (more) line.append(text('span', 'acct-subjects-more', ` · +${more} more`));
  line.title = line.textContent;
  return line;
}

// One card. `list` is false for Needs review, which has no Rename or Delete.
function drawCard({ id, name, keys }, { list, revise }) {
  const n = keys.length;
  const editing = list && ui.edit?.id === id;
  const confirming = list && !editing && ui.confirm === id;

  const head = el('div', 'acct-card-head');
  const count = text('p', 'acct-count', plural(n, 'question', 'questions'));
  if (editing) {
    head.append(renameForm(id, count));
  } else {
    const heading = text('h3', '', name);
    heading.tabIndex = -1;
    heading.dataset.fid = `head|${id}`;
    heading.dataset.kind = 'head';
    head.append(heading, count);
  }

  const card = el('article', 'acct-card', head);
  card.dataset.scope = id;
  if (n) {
    card.append(subjectsLine(keys));
  } else {
    card.append(
      text('p', 'acct-empty', list ? 'No questions yet: use Save to list on any question.' : 'Nothing marked for review.')
    );
  }

  if (editing) return card;
  if (confirming) {
    card.append(confirmBox({ id, name, keys }));
    return card;
  }
  const actions = el('div', 'acct-actions');
  if (n) {
    const link = control('a', 'acct-btn', 'Revise', { id, fid: 'revise', aria: `Revise "${name}"` });
    link.href = revise;
    actions.append(link);
  }
  if (list) {
    actions.append(
      control('button', 'acct-text-btn', 'Rename', { act: 'rename', id, fid: 'rename', aria: `Rename "${name}"` }),
      control('button', 'acct-text-btn', 'Delete', { act: 'delete', id, fid: 'delete', aria: `Delete "${name}"` })
    );
  }
  if (actions.childElementCount) card.append(actions);
  return card;
}

// The Needs review card, then the lists A to Z. The Revise links are built
// here and nowhere in the server's HTML, so the build never sees them.
function drawLists(view) {
  const cards = [
    drawCard({ id: REVIEW_ID, name: 'Needs review', keys: view.review }, { list: false, revise: '/revise?review' }),
    ...view.lists.map((l) => drawCard(l, { list: true, revise: `/revise?list=${encodeURIComponent(l.id)}` })),
  ];
  if (!view.lists.length) cards.push(text('p', 'acct-empty', 'No lists yet: use Save to list on any question.'));

  // The card being renamed, while the person is in its form: a redraw (a sync,
  // a year arriving) must leave it in the page, or the field loses the focus and
  // a phone's keyboard closes mid-word. Everything around it is replaced; its
  // count and subjects are refreshed in place. Only while that form is still
  // the one being edited: Rename activated on another card (without the focus
  // leaving the field) makes ui.edit point there, and keeping this form would
  // leave a dead one beside the new one, and a second #EDIT_INPUT.
  const form = ui.edit ? document.querySelector('.acct-edit') : null;
  const keep =
    form && form.dataset.list === ui.edit.id && form.contains(document.activeElement)
      ? form.closest('.acct-card')
      : null;
  const grid = listsBox.querySelector('.acct-cards');
  const at = keep ? cards.findIndex((c) => c.dataset.scope === keep.dataset.scope) : -1;
  if (!keep || !grid || at < 0) {
    listsBox.replaceChildren(el('div', 'acct-cards', ...cards));
    return;
  }
  const fresh = cards[at];
  keep.querySelector('.acct-count').textContent = fresh.querySelector('.acct-count').textContent;
  keep.querySelector('.acct-subjects, .acct-empty').replaceWith(fresh.querySelector('.acct-subjects, .acct-empty'));
  for (const child of [...grid.children]) if (child !== keep) child.remove();
  keep.before(...cards.slice(0, at));
  keep.after(...cards.slice(at + 1));
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

// The page's body is hidden (account.astro) until its first draw, and the
// colophon until the question indexes have settled as well: By subject is the
// one part whose height nothing can predict, and it is the last thing before
// the colophon. Only the first load is held back. Later draws (a sync, another
// tab) change what is on screen anyway, and must not hide the footer.
//
// A signed-in visitor on a device that has never held their account's data (see
// firstSyncHere) is about to have lists and marks arrive from the first sync,
// which would push down whatever is already showing. So the first reveal waits
// for that sync to end (sawaalbox:sync-done, whatever the outcome), for at most
// FIRST_SYNC_HOLD_MS: a slow sync shows the page as it is rather than nothing.
// A returning device has its data already, and is not held.
const FIRST_SYNC_HOLD_MS = 2500;
let firstLoad = true;
let held = false;
let lastSettled = false;
let landed = false;

// /account#lists (the account menu's "My lists", a bookmark): the browser
// scrolls to the section but puts no focus there, so a keyboard or screen
// reader user would start again from the top of the page. The Revision heading
// takes focus instead (tabindex=-1). It cannot while the body is hidden
// (data-pending), so the first reveal does it, and only if the person has not
// already moved on to something else; a hash change after that is a deliberate
// move and always lands.
function landOnLists(always = false) {
  if (location.hash !== '#lists') return;
  if (!always && document.activeElement !== document.body && document.activeElement !== null) return;
  document.getElementById(LISTS_HEADING)?.focus();
}

function reveal(settled) {
  lastSettled = settled;
  if (held) return;
  acct.removeAttribute('data-pending');
  if (!landed) {
    landed = true;
    landOnLists();
  }
  if (!firstLoad) return;
  acct.toggleAttribute('data-settling', !settled);
  if (settled) firstLoad = false;
}

function releaseHold() {
  if (!held) return;
  held = false;
  reveal(lastSettled);
}

const GONE_ELSEWHERE = 'That list was deleted on another device.';

// `restore: false` for a change the person just made (opening Rename, closing
// Delete): focus is put where those rules say straight after, and restoring
// the old control first would fall back to the Revision heading and scroll.
function render({ state = loadState(), restore = true } = {}) {
  const before = restore ? captureFocus() : null;
  // A list another tab or a sync removed cannot still be open here. Say so: the
  // editor or the question the person was in has gone from under them.
  if ((ui.edit && !state.lists[ui.edit.id]) || (ui.confirm && !state.lists[ui.confirm])) {
    ui.edit = ui.edit && state.lists[ui.edit.id] ? ui.edit : null;
    ui.confirm = ui.confirm && state.lists[ui.confirm] ? ui.confirm : null;
    say(listsNote, GONE_ELSEWHERE);
  }
  const view = summarise(state, index);
  // Settled once no index this state needs is still on its way (summary.js).
  const settled = pendingPaths(state, requests).length === 0;
  drawLists(view);
  drawSummary(view, settled);
  restoreFocus(before);
  reveal(settled);
}

// Draw now with what is known, fetch the years not yet asked for, draw again.
// A student who has marked nothing fetches nothing.
async function refresh() {
  const state = loadState();
  const fresh = indexPathsFor(state).filter((p) => !requests.has(p));
  render({ state });
  if (!fresh.length) return;
  await Promise.all(fresh.map(load));
  render();
}

// --- Rename and Delete. ---

// Both work with no account: a list is on this device first, and the sync (when
// there is one) hears of the change through the same event Save to list sends.
const announce = (id) => document.dispatchEvent(new CustomEvent('sawaalbox:list', { detail: { listId: id } }));
const GONE = 'That list is already gone.';

// Another tab, or a sync, got there first. Show the truth.
function gone() {
  ui.edit = null;
  ui.confirm = null;
  say(listsNote, GONE);
  render({ restore: false });
  document.getElementById(LISTS_HEADING)?.focus();
}

function startRename(id) {
  const list = loadState().lists[id];
  if (!list) return gone();
  ui.edit = { id, value: list.name, error: '' };
  ui.confirm = null;
  say(listsNote, '');
  render({ restore: false });
  const input = document.getElementById(EDIT_INPUT);
  input?.focus();
  input?.select();
}

function stopRename(id) {
  ui.edit = null;
  say(listsNote, '');
  render({ restore: false });
  focusFid(`rename|${id}`);
}

function saveRename(id) {
  if (ui.edit?.id !== id) return; // a submit from a form that is already gone
  const before = loadState();
  const old = before.lists[id];
  if (!old) return gone();
  const input = document.getElementById(EDIT_INPUT);
  // What is wrong, next to the field, kept until the next keystroke; the note
  // announces it too. The field stays open with what was typed.
  const refuse = (message) => {
    ui.edit.error = message;
    if (input) {
      showEditError(input, message);
      input.focus();
    }
    say(listsNote, message);
  };
  let next;
  try {
    next = renameList(before, id, ui.edit.value);
  } catch (error) {
    // A name that is empty, too long, or already another list's.
    return refuse(error instanceof Error ? error.message : String(error));
  }
  if (next === before) return stopRename(id); // the name it already had
  if (!saveState(next)) return refuse(NOT_SAVED);
  ui.edit = null;
  announce(id);
  say(listsNote, `Renamed "${old.name}" to "${next.lists[id].name}".`);
  render({ state: next, restore: false });
  focusFid(`rename|${id}`);
}

function startDelete(id) {
  if (!loadState().lists[id]) return gone();
  ui.confirm = id;
  ui.edit = null;
  say(listsNote, '');
  render({ restore: false });
  focusFid(`delete-no|${id}`);
}

function stopDelete(id) {
  ui.confirm = null;
  render({ restore: false });
  focusFid(`delete|${id}`);
}

function confirmDelete(id) {
  const before = loadState();
  const old = before.lists[id];
  if (!old) return gone();
  // deleteList leaves the tombstone the sync needs to remove the account's copy.
  const next = deleteList(before, id);
  if (!saveState(next)) {
    say(listsNote, NOT_SAVED, { error: true });
    return;
  }
  ui.confirm = null;
  announce(id);
  say(listsNote, `Deleted "${old.name}".`);
  render({ state: next, restore: false });
  document.getElementById(LISTS_HEADING)?.focus();
}

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-act]');
  if (!button) return;
  const id = button.dataset.list;
  switch (button.dataset.act) {
    case 'rename':
      return startRename(id);
    case 'cancel-edit':
      return stopRename(id);
    case 'delete':
      return startDelete(id);
    case 'delete-no':
      return stopDelete(id);
    case 'delete-yes':
      return confirmDelete(id);
  }
});

// Enter in the field, or Save.
document.addEventListener('submit', (event) => {
  const form = event.target.closest?.('.acct-edit');
  if (!form) return;
  event.preventDefault();
  saveRename(form.dataset.list);
});

// Keep what is typed where a redraw will find it, and let the next keystroke
// clear a message about the last one.
document.addEventListener('input', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.id !== EDIT_INPUT || !ui.edit) return;
  ui.edit.value = input.value;
  if (ui.edit.error) {
    ui.edit.error = '';
    showEditError(input, '');
    say(listsNote, '');
  }
});

// Escape closes whatever is open on the card the focus is in, and returns to
// the control that opened it.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const inside = event.target.closest?.('.acct-edit, .acct-confirm');
  if (!inside) return;
  event.preventDefault();
  if (inside.classList.contains('acct-edit')) stopRename(inside.dataset.list);
  else if (ui.confirm) stopDelete(ui.confirm);
});

// --- Where it is kept. ---

const signin = $('[data-signin]');
const where = $('[data-where]');
// The beta terms (account.astro): the same for a student about to sign in and
// one already signed in, so it shows in both modes.
const terms = $('[data-terms]');

function showWhere(mode) {
  where.textContent = WHERE[mode];
  if (signin) signin.hidden = mode !== 'out';
  if (terms) terms.hidden = false;
}

// Dark launch: authEnabled is false, so nothing below runs and the page says
// only what the server wrote, "Kept on this device."
if (authEnabled) {
  signin.addEventListener('click', async () => {
    say(whereNote, '');
    try {
      const { signIn } = await import('./auth.js');
      await signIn();
    } catch {
      say(whereNote, SIGN_IN_FAILED, { error: true });
    }
  });
  document.addEventListener('sawaalbox:signed-in', () => showWhere('in'));
  document.addEventListener('sawaalbox:signed-out', () => {
    showWhere('out');
    releaseHold(); // no account, so no first sync to wait for
  });

  // The masthead control (account.js) settles the question of who is signed
  // in, and writes the answer on itself as data-auth. Reading it covers every
  // way the answer can come: no stored session (settled before this script
  // runs, so an event would be missed), a session that has expired or been
  // revoked, a return from Google that did not complete, and a chunk that would
  // not load. All of them end as "out", and all of them are seen here. This
  // reuses the client account.js already made: no second supabase-js download.
  const control = $('[data-account]');
  const follow = () => {
    if (control?.dataset.auth === 'in') showWhere('in');
    else if (control?.dataset.auth === 'out') {
      showWhere('out');
      releaseHold();
    }
  };

  // The control settles only once supabase-js has looked at a stored session,
  // which is after this page has drawn. Waiting for it would hold the page, and
  // not waiting would let "Kept on this device." turn into "Signed in." under the
  // reader. So the status lines are decided now, from the same hint that decides
  // whether supabase-js is loaded at all: a stored session means signed in. Only a
  // session that turns out to be stale (expired, revoked) changes them again.
  const storageKey = storageKeyFor(SUPABASE_URL);
  let hinted = false;
  let userId = null;
  try {
    hinted = sessionHint(localStorage, location.search, storageKey);
    userId = storedUserId(localStorage, storageKey);
  } catch {
    /* blocked storage: signed out, as far as this page can tell */
  }
  if (control?.dataset.auth) follow();
  else showWhere(hinted ? 'in' : 'out');

  // The first sync here is on its way: hold the first draw until it ends.
  held = hinted && control?.dataset.auth !== 'out' && firstSyncHere(deviceOwner.read(), userId);
  if (held) {
    document.addEventListener('sawaalbox:sync-done', releaseHold);
    setTimeout(releaseHold, FIRST_SYNC_HOLD_MS);
  }
  if (control) new MutationObserver(follow).observe(control, { attributes: true, attributeFilter: ['data-auth'] });
}

// Following "My lists" while already on this page: the address changes only by
// its hash, so nothing loads (hashchange), or, when it was already #lists,
// nothing changes at all (the click).
window.addEventListener('hashchange', () => landOnLists(true));
document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[href]');
  if (link && link.pathname === location.pathname && link.hash === '#lists') setTimeout(() => landOnLists(true));
});

// A sync that lands brings the account's marks and lists, and possibly years
// this page has not fetched. Other tabs and a restored page change storage too.
document.addEventListener('sawaalbox:synced', refresh);
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) refresh();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) refresh();
});
// A year that failed because the connection was down is asked for again when
// it comes back.
window.addEventListener('online', () => {
  let retry = false;
  for (const [path, status] of requests) {
    if (status === 'failed') {
      requests.delete(path);
      retry = true;
    }
  }
  if (retry) refresh();
});

refresh();
