import { abandonAttempt, attemptName, progressLine, remainingMs } from '../lib/tests/attempt.js';
import { TESTS_KEY, finished, getAttempt, loadTests, putAttempt, saveTests, unfinished } from '../lib/tests/store.js';
import { formatDate, formatScore } from '../lib/tests/score.js';
import { formatClock } from '../lib/tests/clock.js';
import { SUPABASE_URL, firstSyncHere, sessionHint, storageKeyFor, storedUserId } from '../lib/accounts/config.js';
import { deviceOwner } from '../lib/accounts/pull.js';

// /upsc/test: this device's unfinished attempts (Carry on) and submitted ones
// (Past results). The papers list is the page's own markup; the practice-set
// form is practice-form.js. Everything here is drawn with textContent: names
// and ids come from storage, which is the user's.

const RESULTS_SHOWN = 20;
const FIRST_SYNC_HOLD_MS = 2500;

const $ = (selector) => document.querySelector(selector);
const wrap = $('.tp');
const note = $('[data-note]');
const carry = $('#carry');
const carryList = $('[data-carry]');
const results = $('#results');
const resultsList = $('[data-results]');
const more = $('[data-more]');
const moreButton = $('[data-more-button]');
const dialog = $('[data-abandon-dialog]');

let showAll = false;
let abandoning = null; // the id the open dialog is about
let drawn = null; // what the last full draw listed (see listed)

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const link = (className, href, text) => {
  const a = el('a', className, text);
  a.href = href;
  return a;
};

const carryDetail = (a) => `${progressLine(a)} · ${formatClock(remainingMs(a))} left`;

function carryRow(a) {
  const row = el('li', 'tp-row');
  row.dataset.id = a.id;
  const abandon = el('button', 'tp-btn', 'Abandon');
  abandon.type = 'button';
  abandon.dataset.abandon = a.id;
  const actions = el('span', 'tp-row-actions');
  actions.append(link('tp-link-btn', `/upsc/test/take?attempt=${encodeURIComponent(a.id)}`, 'Resume'), abandon);
  // The spaces are not laid out (flex), but keep the row's text in words for
  // anything that reads it whole.
  row.append(el('span', 'tp-row-name', attemptName(a)), ' ', el('span', 'tp-row-detail', carryDetail(a)), ' ', actions);
  return row;
}

function resultRow(a) {
  const row = el('li', 'tp-row');
  row.dataset.id = a.id;
  row.append(
    link('tp-row-name', `/upsc/test/result?attempt=${encodeURIComponent(a.id)}`, attemptName(a)),
    ' ',
    el('span', 'tp-row-detail', formatDate(a.submittedAt)),
    ' ',
    el('span', 'serial tp-row-score', `${formatScore(a.result.score)} / ${a.result.max}`)
  );
  return row;
}

// Which attempts the lists hold, in order. An attempt's name, date and score
// never change once it is listed; only an unfinished one's answered count and
// time left do, and those are written into its row where it stands.
const listed = (open, done) => JSON.stringify([open.map((a) => a.id), done.map((a) => a.id), showAll]);

function draw() {
  const tests = loadTests();
  const open = unfinished(tests);
  carry.hidden = open.length === 0;
  carryList.replaceChildren(...open.map(carryRow));
  const done = finished(tests);
  results.hidden = done.length === 0;
  const shown = showAll ? done : done.slice(0, RESULTS_SHOWN);
  resultsList.replaceChildren(...shown.map(resultRow));
  more.hidden = shown.length === done.length;
  moreButton.textContent = `Show all ${done.length}`;
  drawn = listed(open, done);
}

// Storage changed under the page: another tab, or a sync. A test running in
// another tab saves its clock every few seconds, and each save lands here; a
// full draw each time would rebuild the rows under a keyboard or screen reader
// user every 5 s. So the rows are rebuilt only when the attempts listed have
// changed, and focus goes back to the same control in the same row if it is
// still there. Otherwise only the changing lines are rewritten.
function refresh() {
  const tests = loadTests();
  const open = unfinished(tests);
  if (listed(open, finished(tests)) === drawn) {
    open.forEach((a, i) => {
      const detail = carryList.children[i]?.querySelector('.tp-row-detail');
      const text = carryDetail(a);
      if (detail && detail.textContent !== text) detail.textContent = text;
    });
    return;
  }
  const focused = document.activeElement;
  const row = focused?.closest?.('.tp-row');
  const list = row?.parentElement;
  const at = row ? [...row.querySelectorAll('a, button')].indexOf(focused) : -1;
  draw();
  if (!row || at < 0) return;
  const again = [...list.children].find((r) => r.dataset.id === row.dataset.id);
  again?.querySelectorAll('a, button')[at]?.focus();
}

moreButton.addEventListener('click', () => {
  showAll = true;
  draw();
  // The button has gone; land on the first result it brought.
  resultsList.children[RESULTS_SHOWN]?.querySelector('a')?.focus();
});

carryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-abandon]');
  if (!button) return;
  const a = getAttempt(loadTests(), button.dataset.abandon);
  if (!a) return;
  abandoning = a.id;
  $('[data-abandon-title]').textContent = `Abandon ${attemptName(a)}?`;
  dialog.showModal();
});

dialog.addEventListener('close', () => {
  const choice = dialog.returnValue;
  dialog.returnValue = '';
  const id = abandoning;
  abandoning = null;
  if (choice !== 'abandon' || !id) {
    // The browser puts focus back on the Abandon button that opened the
    // dialog, unless a redraw meanwhile replaced it; then on its replacement.
    if (id && !carryList.contains(document.activeElement)) {
      [...carryList.children].find((r) => r.dataset.id === id)?.querySelector('[data-abandon]')?.focus();
    }
    return;
  }
  const tests = loadTests();
  const a = getAttempt(tests, id);
  if (!a || a.status !== 'in_progress') return draw();
  if (!saveTests(putAttempt(tests, abandonAttempt(a, new Date().toISOString())))) {
    note.textContent = 'Your browser would not save that. Check that it lets this site store data.';
    return;
  }
  document.dispatchEvent(new CustomEvent('sawaalbox:test'));
  draw();
  note.textContent = 'Abandoned. Its answers are kept.';
  // The row and its button are gone; land somewhere that still exists.
  (carry.hidden ? $('#tp-papers-h') : carryList.querySelector('a, button'))?.focus?.();
});

// The first draw shows the page (index.astro keeps .tp hidden until then), so
// it waits for two things.
//
// The faces. Carry on and the papers are set in Archivo, Literata and Courier
// Prime; shown before a face is ready, a row rewraps when it swaps in (measured
// at 360px: the Carry on row's detail and buttons moved, 0.011). So the first
// draw waits for them, briefly, as the take and results pages do.
const FONT_WAIT_MS = 3000;
const FACES = ['400 1em "Courier Prime"', '700 1em "Courier Prime"', '400 1em Literata', '700 1em "Archivo Variable"'];
function fontsReady() {
  if (!document.fonts?.load) return Promise.resolve();
  const faces = Promise.all(FACES.map((font) => document.fonts.load(font)));
  return Promise.race([faces, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).catch(() => {});
}

// And the first sync. A signed-in visitor on a device that has never held their
// account's data is about to have attempts arrive from the first sync, which
// would push the papers down. Hold the first draw for that sync, as /account
// does (progress-page.js), for at most FIRST_SYNC_HOLD_MS: a slow sync shows
// the page as it is rather than nothing. A returning device has its data
// already, and is not held. Neither is a session the masthead control has
// found to be over (data-auth="out"; expired or revoked): no sync is coming.
//
// With sign-in switched off, SUPABASE_URL is '' and storageKeyFor('') throws
// (new URL('')), so the catch below leaves `held` false: nothing to wait for.
const control = $('[data-account]');
let held = false;
try {
  const storageKey = storageKeyFor(SUPABASE_URL);
  held =
    control?.dataset.auth !== 'out' &&
    sessionHint(localStorage, location.search, storageKey) &&
    firstSyncHere(deviceOwner.read(), storedUserId(localStorage, storageKey));
} catch {
  /* sign-in off, or blocked storage: nothing to wait for */
}
const firstSync = held
  ? new Promise((release) => {
      document.addEventListener('sawaalbox:sync-done', release, { once: true });
      setTimeout(release, FIRST_SYNC_HOLD_MS);
      if (!control) return;
      const watch = new MutationObserver(() => {
        if (control.dataset.auth !== 'out') return;
        watch.disconnect();
        release();
      });
      watch.observe(control, { attributes: true, attributeFilter: ['data-auth'] });
    })
  : null;

Promise.all([fontsReady(), firstSync]).then(() => {
  draw();
  delete wrap.dataset.pending;
});

document.addEventListener('sawaalbox:synced', () => {
  if (!wrap.dataset.pending) refresh();
});
window.addEventListener('storage', (event) => {
  if (event.key === TESTS_KEY || event.key === null) refresh();
});
// A page restored from the back/forward cache (Back from a test just resumed)
// ran nothing while it was away.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) refresh();
});
