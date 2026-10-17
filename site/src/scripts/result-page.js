import { OPTIONS, attemptName } from '../lib/tests/attempt.js';
import { TESTS_KEY, getAttempt, loadTests } from '../lib/tests/store.js';
import { accuracy, bySubject, formatDate, officialAnswer, resultLine } from '../lib/tests/score.js';
import { REVIEW_FILTERS, reviewKeys, verdictOf, verdictText } from '../lib/tests/review.js';
import { fullEntry, fullPath, fullPathsFor, serialOf } from '../lib/accounts/summary.js';
import { questionHTML } from '../lib/question-html.js';

// The results page, /upsc/test/result?attempt=<id> (spec, "3. Results"): the
// score, By subject, and every question reviewed against the official answer.
//
// The head comes from this device's storage alone, so it is drawn at once: the
// stored result carries the score. By subject and the review need the questions,
// from the per-year full files, fetched only for the years the test is in; they
// are drawn once every one of those files has loaded or failed, below the head,
// with the colophon held back until then (data-settling; see result.astro), so
// nothing the reader can see moves. Each question is the same block the search
// and revise pages render (lib/question-html.js), and marks.js, loaded by the
// page beside this script, fills its marks slot as it lands.
//
// Text from storage and the year files goes in with textContent only; the one
// HTML string is questionHTML's, built from an entry fullEntry has checked.

const PAGE = 20;
// How long one year's file may take, reading the body included. Past this the
// year counts as failed, with Try again, rather than leaving the page waiting
// on a connection that has stalled.
const FILE_TIMEOUT_MS = 15000;
const FONT_WAIT_MS = 3000;
const NOT_HERE = "This test isn't on this device.";
const NO_ID = 'Open a result from Practice tests to see it here.';
const NOT_FINISHED = "This test isn't finished yet.";
const ABANDONED = 'You abandoned this test, so it has no result.';
const NOT_LOADED = "This question didn't load.";
const GONE = "This question isn't in our copy any more.";
const MALFORMED = "This question couldn't be shown.";

const $ = (selector) => document.querySelector(selector);
const sheet = $('.result');
const titleEl = $('[data-title]');
const whenEl = $('[data-when]');
const timeupEl = $('[data-timeup]');
const scoreEl = $('[data-score]');
const accuracyEl = $('[data-accuracy]');
const linksEl = $('[data-links]');
const note = $('[data-note]');
const retryRow = $('[data-retry-row]');
const retryAll = $('[data-retry-all]');
const subjectsSection = $('[data-subjects-section]');
const subjectsBody = $('[data-subjects]');
const reviewSection = $('[data-review-section]');
const filtersEl = $('[data-filters]');
const items = document.getElementById('rs-items');
const more = $('[data-more]');
const moreButton = more.querySelector('button');

const params = new URLSearchParams(location.search);
const id = params.get('attempt') ?? '';
const timeUpAsked = params.has('timeup');

const el = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
};
const text = (tag, className, value) => el(tag, className, value);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const yearOf = (path) => /(\d{4})\.json$/.exec(path)?.[1] ?? '';
const link = (label, href) => {
  const a = text('a', '', label);
  a.href = href;
  return a;
};

// The page's one live region. It holds its line's height whether or not it says
// anything (see .rs-note), so a message coming or going moves nothing; a
// failure is drawn as one.
function say(message, { error = false } = {}) {
  note.textContent = message;
  note.toggleAttribute('data-error', error && Boolean(message));
}

// --- What is on screen. ---

let shownAs = null; // what the page last drew for this id: 'missing', or the attempt's status
let attempt = null; // the submitted attempt whose results are drawn, else null
let filter = 'all';
let order = []; // the keys the current filter shows, in test order
let shown = 0; // how many of them are on the page
let retrying = false;

// --- The year files (the /revise loader). ---

const files = new Map(); // path -> { status: 'loading' | 'loaded' | 'failed', data, promise }

function load(path) {
  const file = { status: 'loading', data: null, promise: null };
  files.set(path, file);
  file.promise = (async () => {
    // A controller and a timer rather than AbortSignal.timeout, which older
    // Safari lacks: without a limit a stalled request would hold the review,
    // and the colophon behind it, for ever.
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
  })();
  return file;
}

// Every year the test is in, in parallel; one already loaded (or on its way) is
// not asked for again. Resolves once each has loaded or failed.
function loadAll(paths) {
  for (const path of paths) {
    const status = files.get(path)?.status;
    if (status !== 'loaded' && status !== 'loading') load(path);
  }
  return Promise.all(paths.map((path) => files.get(path).promise));
}

const failedPaths = () => (attempt ? fullPathsFor(attempt.keys).filter((path) => files.get(path)?.status === 'failed') : []);

/** A question's checked full-file entry, or null when its year did not load or it is gone. */
function entryOf(key) {
  const file = files.get(fullPath(key));
  if (file?.status !== 'loaded') return null;
  const entry = fullEntry(file.data, key);
  return entry.status === 'ok' ? entry.q : null;
}
const officialOf = (key) => officialAnswer(entryOf(key));
const chosen = (key) => (Object.hasOwn(attempt.answers, key) ? attempt.answers[key] : null);

// --- The head: drawn from storage alone. ---

function drawHead(stored) {
  const name = stored ? attemptName(stored) : '';
  titleEl.textContent = name || 'Results';
  document.title = `${name ? `${name}: results` : 'Test results'} | SawaalBox`;
  whenEl.textContent = '';
  timeupEl.hidden = true;
  scoreEl.textContent = '';
  accuracyEl.textContent = '';

  const links = [];
  if (stored?.status === 'in_progress') links.push(link('Resume', `/upsc/test/take?attempt=${encodeURIComponent(stored.id)}`));
  links.push(link('Practice tests', '/upsc/test'));
  if (stored && stored.status !== 'in_progress' && stored.kind === 'paper') {
    links.push(link('Sit this paper again', `/upsc/test/take?paper=${stored.spec.year}`));
  }
  linksEl.replaceChildren(...links);

  if (stored?.status !== 'submitted') return;
  const { result } = stored;
  whenEl.textContent = `Submitted ${formatDate(stored.submittedAt)}`;
  timeupEl.hidden = !(timeUpAsked || stored.elapsedMs >= stored.limitMs);
  scoreEl.textContent = resultLine(result, Math.min(stored.elapsedMs, stored.limitMs));
  const share = accuracy(result);
  accuracyEl.textContent = share === null ? 'No questions answered' : `Accuracy ${Math.round(share * 100)}% of answered questions`;
}

// --- By subject and the review: drawn once every year has settled. ---

function drawSubjects() {
  const rows = bySubject(attempt.keys, attempt.answers, entryOf);
  const num = (n) => text('td', 'rs-num', String(n));
  subjectsBody.replaceChildren(
    ...rows.map((r) => {
      const head = text('th', '', r.subject);
      head.scope = 'row';
      return el('tr', '', head, num(r.right), num(r.wrong), num(r.blank));
    })
  );
  // Every year failed: no subject to put a question under, so no table.
  subjectsSection.hidden = rows.length === 0;
}

// The filters, each with its count. Built once and updated in place, so a
// focused filter keeps its focus when a retried year changes the counts.
function drawFilters() {
  if (!filtersEl.childElementCount) {
    filtersEl.append(
      ...REVIEW_FILTERS.map((f) => {
        const b = text('button', '', '');
        b.type = 'button';
        b.dataset.filter = f.id;
        return b;
      })
    );
  }
  for (const b of filtersEl.querySelectorAll('button[data-filter]')) {
    const f = REVIEW_FILTERS.find((x) => x.id === b.dataset.filter);
    b.textContent = `${f.label} (${reviewKeys(attempt, officialOf, f.id).length})`;
    b.setAttribute('aria-pressed', String(f.id === filter));
  }
}

const EMPTY = {
  all: 'This test has no questions.',
  wrong: 'No wrong answers.',
  blank: 'Every question was answered.',
  review: 'No questions were marked for review.',
};

function showingLine(id, n) {
  if (!n) return EMPTY[id];
  if (id === 'wrong') return `Showing ${plural(n, 'wrong answer', 'wrong answers')}`;
  if (id === 'blank') return `Showing ${plural(n, 'question', 'questions')} not answered`;
  if (id === 'review') return `Showing ${plural(n, 'question', 'questions')} marked for review`;
  return n === 1 ? 'Showing the 1 question' : `Showing all ${n} questions`;
}

// A question that cannot be shown, by its serial: the one thing known about it.
// The spaces between the parts are for a screen reader, which would otherwise
// run "2019 · Q7" into the sentence after it; the flex layout ignores them.
function noteRow(key, message, ...after) {
  const parts = [text('span', 'serial rs-serial', serialOf(key)), text('span', 'rs-row-text', message), ...after];
  const row = el('div', 'rs-row', ...parts.flatMap((part, i) => (i ? [' ', part] : [part])));
  row.tabIndex = -1; // where focus goes when it has to land on this question
  return row;
}

function retryButton(path) {
  const b = text('button', 'rs-text-btn', 'Try again');
  b.type = 'button';
  b.dataset.retry = '';
  b.setAttribute('aria-label', `Try again to load questions from ${yearOf(path)}`);
  return b;
}

// One question as reviewed: the block every page shows, with its answer seal
// already broken, a line on what the student chose and what it scored, and a
// tag on the option they chose.
function reviewBlock(q, key) {
  const template = document.createElement('template');
  template.innerHTML = questionHTML(q);
  const block = template.content.querySelector('.qblock');
  block.querySelector('.qanswer')?.setAttribute('open', '');
  const official = officialAnswer(q);
  const mine = chosen(key);
  const verdict = text('p', 'rs-verdict', verdictText(verdictOf(attempt, key, official), mine, official));
  block.insertBefore(verdict, block.querySelector(':scope > .qmarks'));
  if (mine) {
    // Inside the option's text, so the tag runs on after its last word rather
    // than taking a row of the option's two-column grid.
    const option = block.querySelectorAll('.qopts li')[OPTIONS.indexOf(mine)];
    option?.querySelector('.qopt-text')?.append(' ', text('span', 'rs-pick', 'Your answer'));
  }
  return template.content;
}

function item(key) {
  const node = el('div', 'rs-item');
  const path = fullPath(key);
  const file = path ? files.get(path) : null;
  if (file?.status !== 'loaded') {
    node.append(noteRow(key, NOT_LOADED, retryButton(path ?? '')));
    return node;
  }
  const entry = fullEntry(file.data, key);
  if (entry.status === 'ok') node.append(reviewBlock(entry.q, key));
  else node.append(noteRow(key, entry.status === 'absent' ? GONE : MALFORMED));
  return node;
}

const focusTarget = (node) => node?.querySelector('.qtext a, .rs-row') ?? null;

function drawMore() {
  const left = order.length - shown;
  more.hidden = left <= 0;
  moreButton.textContent = `Show ${Math.min(PAGE, left)} more`;
}

// The next 20 of the current filter; returns the first one added.
function addItems() {
  const next = order.slice(shown, shown + PAGE).map(item);
  items.append(...next);
  shown += next.length;
  drawMore();
  return next[0] ?? null;
}

function showFilter(id) {
  filter = id;
  for (const b of filtersEl.querySelectorAll('button[data-filter]')) {
    b.setAttribute('aria-pressed', String(b.dataset.filter === id));
  }
  order = reviewKeys(attempt, officialOf, id);
  shown = 0;
  items.replaceChildren();
  if (!order.length) items.append(text('p', 'rs-empty', EMPTY[id]));
  addItems();
}

function failedSummary(failed) {
  const which = failed.length === 1 ? yearOf(failed[0]) : `${failed.length} years`;
  return `Couldn't load questions from ${which}. Check your connection, then try again.`;
}

function drawResults() {
  try {
    drawSubjects();
    drawFilters();
    showFilter(filter);
    reviewSection.hidden = false;
    const failed = failedPaths();
    retryRow.hidden = failed.length === 0;
    say(failed.length ? failedSummary(failed) : '', { error: failed.length > 0 });
  } finally {
    // The colophon is out of the page until this clears, with no timed way
    // back (result.astro): whatever happens above, it comes back.
    sheet.removeAttribute('data-settling');
  }
}

// --- Opening the attempt. ---

function start() {
  const stored = id ? getAttempt(loadTests(), id) : null;
  shownAs = stored?.status ?? 'missing';
  attempt = stored?.status === 'submitted' ? stored : null;
  filter = 'all';
  drawHead(stored);
  subjectsSection.hidden = true;
  reviewSection.hidden = true;
  retryRow.hidden = true;
  if (!attempt) {
    if (!stored) say(id ? NOT_HERE : NO_ID);
    else say(stored.status === 'in_progress' ? NOT_FINISHED : ABANDONED);
    sheet.removeAttribute('data-settling');
    return;
  }
  // By subject and the review come once the years are in; until then the
  // colophon, the only thing below them, is out of the page (result.astro).
  sheet.setAttribute('data-settling', '');
  say(`Loading ${plural(attempt.keys.length, 'question', 'questions')}…`);
  const opened = attempt;
  loadAll(fullPathsFor(attempt.keys)).then(() => {
    if (attempt === opened) drawResults();
  });
}

// --- What the person does. ---

filtersEl.addEventListener('click', (event) => {
  const b = event.target.closest?.('button[data-filter]');
  if (!b || !attempt) return;
  showFilter(b.dataset.filter);
  say(showingLine(filter, order.length));
});

moreButton.addEventListener('click', () => {
  if (!attempt) return;
  focusTarget(addItems())?.focus();
});

// Try again (the note's, or a question's), and a connection that comes back:
// every year that failed is asked for again. While they load, By subject and
// the review are out of the page with the colophon, and come back drawn whole,
// so a question filling in moves nothing under the reader.
async function retry() {
  if (!attempt || retrying) return;
  const failed = failedPaths();
  if (!failed.length) return;
  retrying = true;
  const hadFocus = reviewSection.contains(document.activeElement) || retryRow.contains(document.activeElement);
  sheet.setAttribute('data-settling', '');
  subjectsSection.hidden = true;
  reviewSection.hidden = true;
  retryRow.hidden = false;
  retryAll.textContent = 'Loading…';
  retryAll.setAttribute('aria-disabled', 'true');
  if (hadFocus) retryAll.focus();
  say(`Loading questions from ${failed.length === 1 ? yearOf(failed[0]) : `${failed.length} years`}…`);
  const opened = attempt;
  await loadAll(failed);
  retrying = false;
  retryAll.textContent = 'Try again';
  retryAll.removeAttribute('aria-disabled');
  if (attempt !== opened) return;
  const focusAfter = retryRow.contains(document.activeElement);
  drawResults();
  if (focusAfter && retryRow.hidden) (focusTarget(items.querySelector('.rs-item')) ?? titleEl).focus();
}

retryAll.addEventListener('click', () => {
  if (retryAll.getAttribute('aria-disabled') !== 'true') retry();
});
items.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-retry]')) retry();
});
window.addEventListener('online', retry);

// Storage changed under the page: a sync landed, or another tab wrote. Results
// once drawn never change under the reader. A page that said the test is not
// here, not finished or abandoned is drawn again when that is no longer true
// (a sync brought it, or it was submitted in another tab).
function reread() {
  if (shownAs === 'submitted') return;
  const stored = id ? getAttempt(loadTests(), id) : null;
  if ((stored?.status ?? 'missing') !== shownAs) start();
}
document.addEventListener('sawaalbox:synced', reread);
window.addEventListener('storage', (event) => {
  if (event.key === TESTS_KEY || event.key === null) reread();
});
// A page restored from the back/forward cache ran nothing while it was away.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) reread();
});

// The head is set in Archivo, the score's lines in Literata, and the review and
// the table in Courier Prime in part. Drawn before a face is ready, they would
// move when it swaps in; so the first draw waits for them, briefly.
const FACES = ['400 1em "Courier Prime"', '700 1em "Courier Prime"', '400 1em Literata', '700 1em "Archivo Variable"'];
function fontsReady() {
  if (!document.fonts?.load) return Promise.resolve();
  const faces = Promise.all(FACES.map((font) => document.fonts.load(font)));
  return Promise.race([faces, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).catch(() => {});
}

fontsReady().then(() => {
  start();
  // Drawn: show it (result.astro keeps it hidden until now, so nothing it holds
  // moves when the script fills it in).
  sheet.removeAttribute('data-pending');
});
