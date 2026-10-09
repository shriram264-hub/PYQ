import { STORAGE_KEY, loadState, saveState } from '../lib/accounts/progress-store.js';
import { removeKey } from '../lib/accounts/lists.js';
import {
  fullEntry,
  fullPath,
  fullPathsFor,
  reviewOldestFirst,
  reviseTarget,
  serialOf,
  subjectsCovered,
} from '../lib/accounts/summary.js';
import { canonical, questionHTML, questionPath } from '../lib/question-html.js';

// The /revise page: one revision list (?list=<id>) or the Needs review pile
// (?review), every question in full, 20 at a time. The keys come from this
// device's storage (a sync, when signed in, keeps it in step with the account);
// the questions come from the per-year full files, fetched only for the years
// those keys are in. Each question is the same block the search page renders
// (lib/question-html.js), and marks.js, loaded by the page beside this script,
// fills its marks slot as it lands, so Mark done, Needs review and Save to list
// work here exactly as they do everywhere else.
//
// Nothing moves under the reader. The questions are drawn in order, and one is
// drawn only once every question before it can be: until then it holds a
// placeholder of reserved height that paints nothing, so a year arriving late
// fills space no one can see yet. The colophon and the Show more button, the
// only things below the questions, stay hidden while any placeholder is left
// (data-settling; see revise.astro).

const PAGE = 20;
// How long one year's file may take, reading the body included. Past this the
// year counts as failed, with Try again, rather than leaving the page waiting
// on a connection that has stalled.
const FILE_TIMEOUT_MS = 15000;
const NOT_SAVED = 'Your browser would not save that. Check that it lets this site store data.';
const NOT_HERE = "This list isn't on this device.";
// What the live region says when the list goes while the page is open: the same
// words /account uses (progress-page.js), where the same thing happens. The
// page itself then shows NOT_HERE, which is what is true from here on.
const GONE_ELSEWHERE = 'That list was deleted on another device.';

const $ = (selector) => document.querySelector(selector);
const sheet = $('.revise');
const titleEl = $('[data-title]');
const countEl = $('[data-count]');
const subjectsEl = $('[data-subjects]');
const note = $('[data-note]');
const items = document.getElementById('revise-items');
const more = $('[data-more]');
const moreButton = more.querySelector('button');

const el = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
};
// Built with textContent, never an HTML string: a list name and a stored key are
// the student's text, and markup in them must stay inert. The one HTML string on
// this page is questionHTML's, built from an entry fullEntry has checked, with
// every text field escaped.
const text = (tag, className, value) => el(tag, className, value);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const button = (className, label) => {
  const node = text('button', className, label);
  node.type = 'button';
  return node;
};
const yearOf = (path) => /(\d{4})\.json$/.exec(path)?.[1] ?? '';

// The page's one live region. It holds its line's height whether or not it says
// anything (see .rv-note), so a message coming or going moves nothing; a
// failure is drawn as one.
function say(message, { error = false } = {}) {
  note.textContent = message;
  note.toggleAttribute('data-error', error && Boolean(message));
}

// --- What this visit is revising. ---

const target = reviseTarget(location.search);
// Own properties only: ?list=constructor is not a list.
const listOf = (state) =>
  target.mode === 'list' && Object.hasOwn(state.lists, target.id) ? state.lists[target.id] : null;

let missing = false; // the list asked for is not on this device (or nothing was asked for)
let name = ''; // the list's name as last drawn
// The keys being revised, captured when the page opens: a question marked Done
// while revising Needs review stays on the page until the next visit, and a
// sync does not reorder what the student is part way through.
let order = [];
let shown = 0; // how many of `order` have a place on the page
let slots = []; // { key, el, state } for order[0 .. shown), in order
const slotOf = new WeakMap(); // a slot's element -> the slot
let loadingNote = false; // the note says "Loading n questions…"
let moreBusy = false;

// The questions are the first thing on this page set in Courier Prime (their
// serials and option keys), and a browser fetches a face only once some text
// needs it. A question drawn before the face is ready is laid out in the
// fallback, and moves when Courier Prime swaps in, even from the cache. So both
// weights are asked for when there are questions to show, while their year
// files load, and the first questions are drawn once the face is ready, or
// after FONT_WAIT_MS rather than hold the page for a font.
const FONT_WAIT_MS = 3000;
let fontsReady = !document.fonts?.load;
let fontsAsked = false;
function askFonts() {
  if (fontsReady || fontsAsked) return;
  fontsAsked = true;
  const faces = Promise.all(['400 1em "Courier Prime"', '700 1em "Courier Prime"'].map((font) => document.fonts.load(font)));
  Promise.race([faces, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))])
    .catch(() => {})
    .then(() => {
      fontsReady = true;
      draw();
    });
}

// --- The year files. ---

const files = new Map(); // path -> { status: 'loading' | 'loaded' | 'failed', data, promise }

function load(path) {
  const file = { status: 'loading', data: null, promise: null };
  files.set(path, file);
  file.promise = (async () => {
    // A controller and a timer rather than AbortSignal.timeout, which older
    // Safari lacks: without a limit a stalled request would hold the page's
    // placeholders, and the colophon behind them, for ever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
    try {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a question file');
      file.data = data;
      file.status = 'loaded';
    } catch {
      // Offline, too slow, or not there. Its questions say so, with Try again.
      file.status = 'failed';
    } finally {
      clearTimeout(timer);
    }
    if (files.get(path) === file) draw();
  })();
  return file;
}

// Every year these keys are in, in parallel; a year already asked for is not
// asked for again. The page asks for the first page's years first, and the
// rest only once those have settled (see draw), so the questions on screen
// never wait behind files that only later pages need.
function request(keys) {
  for (const path of fullPathsFor(keys)) if (!files.has(path)) load(path);
}

// The years these keys need that have not settled: not asked for yet, or loading.
const unsettledPaths = (keys) =>
  fullPathsFor(keys).filter((path) => {
    const status = files.get(path)?.status;
    return status !== 'loaded' && status !== 'failed';
  });

// --- One question's place on the page. ---

// What a slot should show now:
//   wait       its year is still on its way (a placeholder)
//   block      the question, from its year's file
//   absent     the loaded file does not have it (it left the question bank)
//   malformed  the file has it, but not in a shape fit to render
//   failed     its year did not load
// A slot showing "failed" keeps showing it while Try again is fetching, so the
// row the person pressed does not vanish under them.
function desired(slot) {
  const path = fullPath(slot.key);
  if (!path) return { state: 'absent' };
  const file = files.get(path);
  if (!file) return { state: 'wait' };
  if (file.status === 'loading') return slot.state === 'failed' ? { state: 'failed', path } : { state: 'wait' };
  if (file.status === 'failed') return { state: 'failed', path };
  const entry = fullEntry(file.data, slot.key);
  return entry.status === 'ok' ? { state: 'block', q: entry.q } : { state: entry.status };
}

// A question that cannot be shown, by its serial: the one thing known about it.
// The spaces between the parts are for a screen reader, which would otherwise
// run "2019 · Q7" into the sentence after it; the flex layout ignores them.
function noteRow(key, message, ...after) {
  const parts = [text('span', 'serial rv-serial', serialOf(key)), text('span', 'rv-row-text', message), ...after];
  const row = el('div', 'rv-row', ...parts.flatMap((part, i) => (i ? [' ', part] : [part])));
  row.tabIndex = -1; // where focus goes when it has to land on this question
  return row;
}

function retryButton(path) {
  const node = button('rv-text-btn', 'Try again');
  node.dataset.retry = path;
  labelRetry(node, path, false);
  return node;
}

// The visible words first, then which year, since a page can hold several; the
// name changes with the words while it is fetching, so a screen reader on the
// button hears that too.
function labelRetry(node, path, busy) {
  const year = yearOf(path);
  node.textContent = busy ? 'Loading…' : 'Try again';
  node.setAttribute('aria-label', busy ? `Loading questions from ${year}` : `Try again to load questions from ${year}`);
  if (busy) node.setAttribute('aria-disabled', 'true');
  else node.removeAttribute('aria-disabled');
}

// The busy state of a failed row's Try again, changed in place so a focused
// button keeps its focus.
function setBusy(slot, path) {
  const retry = slot.el.querySelector('[data-retry]');
  if (!retry) return;
  const busy = files.get(path)?.status === 'loading';
  if ((retry.getAttribute('aria-disabled') === 'true') !== busy) labelRetry(retry, path, busy);
}

function removeStrip(key) {
  const remove = button('rv-text-btn', 'Remove from this list');
  remove.dataset.remove = '';
  remove.setAttribute('aria-label', `Remove from this list: ${serialOf(key)}`);
  return el('div', 'rv-foot', remove);
}

function fill(slot, want) {
  const hadFocus = slot.el.contains(document.activeElement);
  slot.state = want.state;
  slot.el.dataset.state = want.state;
  if (want.state === 'wait') {
    slot.el.setAttribute('aria-hidden', 'true');
    slot.el.replaceChildren();
    return;
  }
  slot.el.removeAttribute('aria-hidden');
  let body;
  if (want.state === 'block') {
    // marks.js sees the block land (its MutationObserver) and fills the empty
    // .qmarks slot, which is already holding the room its buttons take.
    const template = document.createElement('template');
    template.innerHTML = questionHTML(want.q);
    body = template.content;
  } else if (want.state === 'failed') {
    body = noteRow(slot.key, `Couldn't load questions from ${yearOf(want.path)}.`, retryButton(want.path));
  } else if (want.state === 'malformed') {
    body = noteRow(slot.key, "This question couldn't be shown.");
  } else {
    body = noteRow(slot.key, 'This question is no longer in the question bank.');
  }
  slot.el.replaceChildren(body);
  if (target.mode === 'list') slot.el.append(removeStrip(slot.key));
  if (want.state === 'failed') setBusy(slot, want.path);
  if (hadFocus) focusSlot(slot);
}

// Where focus goes to land on a question: its heading's link, or the row that
// stands in for it. Null for a placeholder, which cannot be focused.
const focusTarget = (slot) => slot?.el.querySelector('.qtext a, .rv-row') ?? null;
const focusSlot = (slot) => (focusTarget(slot) ?? titleEl).focus();

function addSlots(n) {
  for (const key of order.slice(shown, shown + n)) {
    const slot = { key, el: el('div', 'rv-item'), state: null };
    slotOf.set(slot.el, slot);
    slots.push(slot);
    fill(slot, { state: 'wait' });
    items.append(slot.el);
  }
  shown += n;
}

// --- Drawing. ---

function draw() {
  if (missing) return;
  // In order: once a slot is waiting, every slot after it that is still
  // waiting keeps waiting, so nothing can appear above what is already drawn.
  // Until the serial face is ready, every slot waits.
  let open = fontsReady;
  for (const slot of slots) {
    const want = desired(slot);
    if (!open && slot.state === 'wait') continue;
    if (want.state !== slot.state) fill(slot, want);
    else if (want.state === 'failed') setBusy(slot, want.path);
    if (slot.state === 'wait') open = false;
  }
  sheet.toggleAttribute('data-settling', slots.some((slot) => slot.state === 'wait'));

  // The years of the questions on the page have settled: now ask for the rest
  // (for Show more and the subjects line).
  if (!unsettledPaths(order.slice(0, shown)).length) request(order);

  // Every year this visit needs has settled: the subjects can be named, and
  // the loading line gives way to what happened.
  if (!unsettledPaths(order).length) {
    drawSubjects();
    if (loadingNote) {
      loadingNote = false;
      say(failedSummary());
    }
  }
}

function failedSummary() {
  const failed = fullPathsFor(order).filter((path) => files.get(path)?.status === 'failed');
  if (!failed.length) return '';
  return failed.length === 1
    ? `Couldn't load questions from ${yearOf(failed[0])}.`
    : `Couldn't load questions from ${failed.length} years.`;
}

function drawHead() {
  const title = target.mode === 'review' ? 'Needs review' : name;
  titleEl.textContent = title;
  document.title = `${title} | SawaalBox`;
  countEl.textContent = plural(order.length, 'question', 'questions');
}

// "Indian Polity · Geography · +2 more", from the entries that loaded. The line
// holds its height while empty, and never wraps: the first part gives way with
// an ellipsis, and "+k more", the part that says there is more, stays.
function drawSubjects() {
  const view = {};
  for (const key of order) {
    const file = files.get(fullPath(key));
    if (file?.status !== 'loaded') continue;
    const entry = fullEntry(file.data, key);
    // subjectsCovered reads the per-year index's shape, [path, subject, title].
    if (entry.status === 'ok') view[key] = [questionPath(entry.q), canonical(entry.q.subject), ''];
  }
  const { top, more: rest } = subjectsCovered(order, view);
  subjectsEl.replaceChildren();
  subjectsEl.removeAttribute('title');
  if (!top.length) return;
  subjectsEl.append(text('span', 'rv-subjects-top', top.join(' · ')));
  if (rest) subjectsEl.append(text('span', 'rv-subjects-more', ` · +${rest} more`));
  subjectsEl.title = subjectsEl.textContent;
}

function drawEmpty() {
  items.querySelector(':scope > .rv-empty')?.remove();
  // No questions, no subjects: the line's reserved room goes (revise.astro).
  sheet.toggleAttribute('data-empty', !order.length);
  if (order.length) return;
  if (target.mode === 'review') {
    items.append(text('p', 'rv-empty', 'Nothing marked for review.'));
    return;
  }
  const link = text('a', '', 'any question');
  link.href = '/upsc';
  items.append(el('p', 'rv-empty', 'No questions yet: use Save to list on ', link, '.'));
}

function drawMore() {
  const left = order.length - shown;
  more.hidden = left <= 0;
  moreButton.textContent = `Show ${Math.min(PAGE, left)} more`;
}

function showMissing() {
  missing = true;
  sheet.toggleAttribute('data-missing', true); // no count or subjects to hold room for
  order = [];
  shown = 0;
  slots = [];
  loadingNote = false;
  titleEl.textContent = 'Revise';
  document.title = 'Revise | SawaalBox';
  countEl.textContent = '';
  subjectsEl.replaceChildren();
  const link = text('a', '', 'Your progress');
  link.href = '/account#lists';
  items.replaceChildren(el('p', 'rv-empty', `${NOT_HERE} `, link, ' shows the lists that are.'));
  more.hidden = true;
  sheet.removeAttribute('data-settling');
}

function start() {
  const state = loadState();
  missing = false;
  sheet.removeAttribute('data-missing');
  const list = listOf(state);
  if (target.mode === 'none' || (target.mode === 'list' && !list)) return showMissing();
  name = list?.name ?? '';
  // A list keeps the order its questions were saved in; Needs review starts
  // with the mark that has waited longest. Once each, whatever storage holds.
  order = [...new Set(target.mode === 'review' ? reviewOldestFirst(state) : list.keys)];
  shown = 0;
  slots = [];
  items.replaceChildren();
  if (order.length) askFonts();
  // The first page's years now; draw asks for the rest once these settle.
  request(order.slice(0, PAGE));
  loadingNote = unsettledPaths(order).length > 0;
  say(loadingNote ? `Loading ${plural(order.length, 'question', 'questions')}…` : '');
  addSlots(Math.min(PAGE, order.length));
  drawHead();
  drawEmpty();
  drawMore();
  draw();
}

// --- What the person does. ---

function remove(slot) {
  const before = loadState();
  const list = listOf(before);
  if (!list) return gone();
  const next = removeKey(before, target.id, slot.key);
  // Already out of the list (another tab, or this question's Save to list
  // panel): nothing to write, but it still leaves the page as asked.
  if (next !== before) {
    if (!saveState(next)) {
      say(NOT_SAVED, { error: true });
      return;
    }
    // sync.js, when signed in, hears this and sends the change.
    document.dispatchEvent(
      new CustomEvent('sawaalbox:list', { detail: { listId: target.id, key: slot.key, added: false } })
    );
  }
  const at = slots.indexOf(slot);
  slots.splice(at, 1);
  order.splice(order.indexOf(slot.key), 1);
  shown -= 1;
  slot.el.remove();
  name = list.name;
  drawHead();
  drawEmpty();
  drawMore();
  draw();
  say(`Removed from "${list.name}".`);
  // Somewhere near where the question was, so the page does not jump: the next
  // question; else (it was the last on the page, or the next is still on its
  // way) Show more, if it is there; else the question before; else, with none
  // left, the page's heading.
  const showing = !more.hidden && !sheet.hasAttribute('data-settling');
  (focusTarget(slots[at]) ?? (showing ? moreButton : null) ?? focusTarget(slots[at - 1]) ?? titleEl).focus();
}

// Appends the next 20. Their years were asked for once the first page's had
// settled; if one is still on its way, wait for it (the button says it is busy)
// so that what is appended is drawn whole, and focus can land on its first
// question.
async function showMore() {
  if (moreBusy || missing) return;
  const next = order.slice(shown, shown + PAGE);
  request(next);
  const waiting = unsettledPaths(next).map((path) => files.get(path).promise);
  if (waiting.length) {
    moreBusy = true;
    moreButton.setAttribute('aria-disabled', 'true');
    await Promise.all(waiting);
    moreBusy = false;
    moreButton.removeAttribute('aria-disabled');
    if (missing) return;
  }
  const first = shown;
  addSlots(Math.min(PAGE, order.length - shown));
  drawMore();
  draw();
  focusSlot(slots[first]);
}

async function retry(path) {
  if (files.get(path)?.status !== 'failed') return;
  const year = yearOf(path);
  const file = load(path);
  draw();
  say(`Loading questions from ${year}…`);
  await file.promise;
  if (missing) return;
  say(file.status === 'loaded' ? `Loaded the questions from ${year}.` : `Couldn't load questions from ${year}.`);
}

// The list went while the page was open: deleted on another device (a sync
// brought that) or in another tab.
function gone() {
  const hadFocus = items.contains(document.activeElement) || more.contains(document.activeElement);
  showMissing();
  say(GONE_ELSEWHERE);
  if (hadFocus) titleEl.focus();
}

// Storage changed under the page: a sync landed, or another tab wrote. The
// questions on the page stay as they are (see `order`); what can change is the
// list's name, whether it is still here at all, and an empty page filling.
function reread() {
  if (target.mode === 'none') return;
  const state = loadState();
  const list = listOf(state);
  if (target.mode === 'list') {
    if (!list) {
      if (!missing) gone();
      return;
    }
    if (missing) return start();
    if (list.name !== name) {
      name = list.name;
      drawHead();
    }
  }
  // Nothing was there when the page opened (a first sync on a new device, say),
  // and now there is: open it properly.
  if (!order.length && (target.mode === 'review' ? reviewOldestFirst(state) : list.keys).length) start();
}

document.addEventListener('click', (event) => {
  const removeButton = event.target.closest?.('[data-remove]');
  if (removeButton) {
    const slot = slotOf.get(removeButton.closest('.rv-item'));
    if (slot && slots.includes(slot)) remove(slot);
    return;
  }
  const retryButtonEl = event.target.closest?.('[data-retry]');
  if (retryButtonEl && retryButtonEl.getAttribute('aria-disabled') !== 'true') retry(retryButtonEl.dataset.retry);
});
moreButton.addEventListener('click', () => {
  if (moreButton.getAttribute('aria-disabled') !== 'true') showMore();
});

document.addEventListener('sawaalbox:synced', reread);
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) reread();
});
// A page restored from the back/forward cache ran nothing while it was away.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) reread();
});
// A year that failed because the connection was down is asked for again when
// it comes back.
window.addEventListener('online', () => {
  for (const [path, file] of files) if (file.status === 'failed') retry(path);
});

start();
// Drawn: show it (revise.astro keeps it hidden until now, so nothing it holds
// moves when the script fills it in).
sheet.removeAttribute('data-pending');
