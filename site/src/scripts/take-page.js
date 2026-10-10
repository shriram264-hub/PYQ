import {
  MINUTE,
  PAPER_MINUTES,
  abandonAttempt,
  addElapsed,
  attemptName,
  chooseAnswer,
  clearAnswer,
  moveTo,
  newAttempt,
  remainingMs,
  submitAttempt,
  toggleReview,
} from '../lib/tests/attempt.js';
import { TESTS_KEY, getAttempt, inProgressPaper, loadTests, putAttempt, saveTests } from '../lib/tests/store.js';
import { officialAnswer, resultLine, scoreAttempt } from '../lib/tests/score.js';
import { paperKeys } from '../lib/tests/build.js';
import { canStartTest } from '../lib/tests/access.js';
import { SAVE_EVERY_MS, TICK_CAP_MS, announcementFor, formatClock, keyAction } from '../lib/tests/clock.js';
import { fullEntry, fullPath, fullPathsFor, serialOf } from '../lib/accounts/summary.js';
// A uuid v4 maker; attempts need the same kind of id lists do.
import { newListId as newId } from '../lib/accounts/lists.js';

// The test screen: one question at a time, a question grid, a countdown that
// runs only while the page is in front of the student, and every change saved
// on this device at once (spec, "2. Taking a test"). The rules are in
// lib/tests/; this file is the DOM. Text from storage and the year files goes
// in with textContent only.

const FILE_TIMEOUT_MS = 15000;
const FONT_WAIT_MS = 3000;
const NOT_SAVED = "Your browser isn't saving this test. You can finish it in this tab, but closing it loses your answers.";
const WIDE = window.matchMedia('(min-width: 60rem)');

const $ = (selector) => document.querySelector(selector);
const page = $('.take');
const PAPERS = JSON.parse(page.dataset.papers);
const nameEl = $('[data-name]');
const positionEl = $('[data-position]');
const clockEl = $('[data-clock]');
const submitBtn = $('[data-submit]');
const note = $('[data-note]');
const retryRow = $('[data-retry-row]');
const startEl = $('[data-start]');
const messageEl = $('[data-message]');
const testEl = $('[data-test]');
const serialEl = $('[data-serial]');
const questionEl = $('[data-question]');
const optionsEl = $('[data-options]');
const radios = [...optionsEl.querySelectorAll('input[type=radio]')];
const optionText = Object.fromEntries([...optionsEl.querySelectorAll('[data-option]')].map((n) => [n.dataset.option, n]));
const clearBtn = $('[data-clear]');
const reviewBtn = $('[data-review]');
const prevBtn = $('[data-prev]');
const nextBtn = $('[data-next]');
const gridBox = $('[data-grid-box]');
const grid = $('[data-grid]');
const gridSummary = $('[data-grid-summary]');
const announcer = $('[data-announce]');
const submitDialog = $('[data-submit-dialog]');
const abandonDialog = $('[data-abandon-dialog]');

let attempt = null; // the attempt on screen: as last saved, or held here when storage refuses
const files = new Map(); // year-file path -> its data, once loaded
let saveFailed = false;
let finished = false; // submitted or abandoned from this page: no more changes from here
let cells = [];
let timer = null;
let lastTick = 0;
let lastSave = 0;
let pendingMs = 0; // counted since the last save

const iso = () => new Date().toISOString();
const resultUrl = (id) => `/upsc/test/result?attempt=${encodeURIComponent(id)}`;

function say(message, { error = false } = {}) {
  note.textContent = message;
  note.toggleAttribute('data-error', error && Boolean(message));
}

// Cleared first, set a frame later, so the same words said twice are heard twice.
function announce(message) {
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

function show(view) {
  page.dataset.view = view;
  startEl.hidden = view !== 'start';
  messageEl.hidden = view !== 'message';
  testEl.hidden = view !== 'test';
  delete page.dataset.pending;
}

function message(text) {
  stopTimer();
  document.querySelector('[data-message-text]').textContent = text;
  show('message');
}

// --- The year files (the /revise loader pattern). ---

async function fetchYear(path) {
  // A controller and a timer rather than AbortSignal.timeout, which older Safari lacks.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
  try {
    const response = await fetch(path, { signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a question file');
    files.set(path, data);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadQuestions() {
  const missing = fullPathsFor(attempt.keys).filter((path) => !files.has(path));
  const loaded = await Promise.all(missing.map(fetchYear));
  return loaded.every(Boolean);
}

/** A question's checked full-file entry, or null when its year is not loaded or it is gone. */
function entryOf(key) {
  const data = files.get(fullPath(key));
  if (!data) return null;
  const entry = fullEntry(data, key);
  return entry.status === 'ok' ? entry.q : null;
}
const officialOf = (key) => officialAnswer(entryOf(key));

// --- Saving. Storage is the truth: every change is applied to the stored copy,
// so a sync or another tab that changed it is built on, not overwritten. ---

function mutate(change) {
  if (finished) return false;
  const now = iso();
  const tests = loadTests();
  const stored = getAttempt(tests, attempt.id);
  if (stored && stored.status !== 'in_progress') {
    closedElsewhere(stored);
    return false;
  }
  const base = stored && !saveFailed ? stored : attempt;
  const next = change(base, now);
  attempt = next;
  if (next !== stored) {
    const ok = saveTests(putAttempt(tests, next));
    if (ok === saveFailed) say(ok ? '' : NOT_SAVED, { error: !ok });
    saveFailed = !ok;
  }
  return true;
}

function closedElsewhere(stored) {
  finished = true;
  attempt = stored;
  stopTimer();
  if (stored.status === 'submitted') location.replace(resultUrl(stored.id));
  else message("This test was abandoned in another tab or on another device. Its answers are kept.");
}

// A sync, or another tab, may change the attempt under us.
function reread() {
  if (!attempt || finished || page.dataset.view !== 'test') return;
  const stored = getAttempt(loadTests(), attempt.id);
  if (!stored) return;
  if (stored.status !== 'in_progress') return closedElsewhere(stored);
  if (stored.updatedAt !== attempt.updatedAt) {
    attempt = stored;
    render();
  }
}
document.addEventListener('sawaalbox:synced', reread);
window.addEventListener('storage', (event) => {
  if (event.key === TESTS_KEY || event.key === null) reread();
});

// --- The clock. ---

const remaining = () => Math.max(0, remainingMs(attempt) - pendingMs);

function flushTime() {
  if (pendingMs > 0) {
    const ms = pendingMs;
    pendingMs = 0;
    mutate((a, now) => addElapsed(a, ms, now));
  }
  lastSave = performance.now();
}

function tick() {
  const t = performance.now();
  const before = remaining();
  pendingMs += Math.min(Math.max(0, t - lastTick), TICK_CAP_MS);
  lastTick = t;
  const after = remaining();
  clockEl.textContent = formatClock(after);
  const spoken = announcementFor(before, after);
  if (spoken) announce(spoken);
  if (after <= 0) return finish({ timeUp: true });
  if (t - lastSave >= SAVE_EVERY_MS) flushTime();
}

function startClock() {
  if (timer || finished || !attempt || page.dataset.view !== 'test' || document.visibilityState !== 'visible') return;
  lastTick = performance.now();
  lastSave = lastTick;
  timer = setInterval(tick, 1000);
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

// Hidden or leaving: count the part-second since the last tick, then save.
function stopClock() {
  if (!timer) return;
  stopTimer();
  tick();
  flushTime();
}

document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? startClock() : stopClock()));
window.addEventListener('pagehide', stopClock);
window.addEventListener('pageshow', (event) => {
  // Only a test on screen has anything to bring up to date; a page put away
  // while its questions were loading picks up where the loader is.
  if (!event.persisted || !attempt || finished || page.dataset.view !== 'test') return;
  const stored = getAttempt(loadTests(), attempt.id);
  if (stored && stored.status !== 'in_progress') return closedElsewhere(stored);
  if (stored) attempt = stored;
  render();
  startClock();
});

// --- Drawing. ---

function drawBar() {
  positionEl.textContent = `Question ${attempt.current + 1} of ${attempt.keys.length}`;
  clockEl.textContent = formatClock(remaining());
}

function buildGrid() {
  cells = attempt.keys.map((_, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tk-cell';
    button.dataset.index = String(i);
    button.textContent = String(i + 1);
    const item = document.createElement('li');
    item.append(button);
    return { item, button };
  });
  grid.replaceChildren(...cells.map((c) => c.item));
}

// On a wide screen the cells scroll in their own box (take.astro): keep the
// current one in it. Scrolling that box moves nothing else on the page.
function keepInView(button) {
  if (!WIDE.matches || grid.scrollHeight <= grid.clientHeight) return;
  const top = button.offsetTop - grid.offsetTop;
  const bottom = top + button.offsetHeight;
  const pad = 6; // the current cell's outline, and a little air
  if (top - pad < grid.scrollTop) grid.scrollTop = Math.max(0, top - pad);
  else if (bottom + pad > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom + pad - grid.clientHeight;
}

function paintGrid() {
  let answered = 0;
  let marked = 0;
  attempt.keys.forEach((key, i) => {
    const isAnswered = Object.hasOwn(attempt.answers, key);
    const isMarked = attempt.review.includes(key);
    answered += isAnswered ? 1 : 0;
    marked += isMarked ? 1 : 0;
    const { button } = cells[i];
    button.toggleAttribute('data-answered', isAnswered);
    button.toggleAttribute('data-review', isMarked);
    if (i === attempt.current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    // The state as words, after the number the cell shows. A label, not hidden
    // text inside the cell: Chrome names a cell "3 : answered" from that, with
    // a space before the colon, as the hidden text is out of the line's flow.
    button.setAttribute('aria-label', `${i + 1}: ${isAnswered ? 'answered' : 'not answered'}${isMarked ? ', marked for review' : ''}`);
  });
  gridSummary.textContent = `${answered} answered · ${marked} marked · ${attempt.keys.length - answered} not answered`;
  keepInView(cells[attempt.current].button);
}

function render() {
  const key = attempt.keys[attempt.current];
  const q = entryOf(key);
  serialEl.textContent = serialOf(key);
  questionEl.textContent = q ? q.question : "This question isn't in our copy any more. It won't be scored.";
  for (const radio of radios) {
    radio.checked = Object.hasOwn(attempt.answers, key) && attempt.answers[key] === radio.value;
    radio.disabled = !q;
    optionText[radio.value].textContent = q ? q[radio.value] : '';
  }
  reviewBtn.setAttribute('aria-pressed', String(attempt.review.includes(key)));
  // A move button that has focus and becomes disabled hands focus to the other.
  const last = attempt.keys.length - 1;
  if (document.activeElement === prevBtn && attempt.current === 0) nextBtn.focus();
  if (document.activeElement === nextBtn && attempt.current === last) prevBtn.focus();
  prevBtn.disabled = attempt.current === 0;
  nextBtn.disabled = attempt.current === last;
  drawBar();
  paintGrid();
}

// --- Acting. ---

const currentKey = () => attempt.keys[attempt.current];

function choose(option) {
  const key = currentKey();
  if (!entryOf(key)) return;
  if (mutate((a, now) => chooseAnswer(a, key, option, now))) render();
}

function go(index) {
  const from = attempt.current;
  if (!mutate((a, now) => moveTo(a, index, now))) return;
  render();
  if (attempt.current !== from) announce(`Question ${attempt.current + 1} of ${attempt.keys.length}`);
}

optionsEl.addEventListener('change', (event) => {
  if (event.target.name === 'tk-answer') choose(event.target.value);
});
clearBtn.addEventListener('click', () => {
  const key = currentKey();
  if (mutate((a, now) => clearAnswer(a, key, now))) render();
});
reviewBtn.addEventListener('click', () => {
  const key = currentKey();
  if (mutate((a, now) => toggleReview(a, key, now))) render();
});
prevBtn.addEventListener('click', () => go(attempt.current - 1));
nextBtn.addEventListener('click', () => go(attempt.current + 1));
grid.addEventListener('click', (event) => {
  const cell = event.target.closest('.tk-cell');
  if (!cell) return;
  go(Number(cell.dataset.index));
  // On a phone the grid covers the question: close it and land on the question.
  if (!WIDE.matches) {
    gridBox.open = false;
    questionEl.focus();
  }
});

const fitGrid = () => {
  gridBox.open = WIDE.matches;
};
WIDE.addEventListener('change', fitGrid);

document.addEventListener('keydown', (event) => {
  if (page.dataset.view !== 'test' || finished || event.defaultPrevented) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (event.target.closest?.('input:not([type=radio]), textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const action = keyAction(event.key);
  if (!action) return;
  event.preventDefault();
  if (action.choose) choose(action.choose);
  else go(attempt.current + action.move);
});

// --- Finishing. ---

function finish({ timeUp = false } = {}) {
  if (finished) return;
  stopTimer();
  flushTime();
  const submitted = mutate((a, now) => submitAttempt(a, scoreAttempt(a.keys, a.answers, officialOf), now));
  if (!submitted) return;
  finished = true;
  document.dispatchEvent(new CustomEvent('sawaalbox:test'));
  if (saveFailed) {
    // Nothing on this device to open the results from: say the score here.
    message(`Submitted. ${resultLine(attempt.result, Math.min(attempt.elapsedMs, attempt.limitMs))}.`);
    return;
  }
  location.replace(`${resultUrl(attempt.id)}${timeUp ? '&timeup' : ''}`);
}

submitBtn.addEventListener('click', () => {
  const answered = Object.keys(attempt.answers).length;
  $('[data-submit-summary]').textContent =
    `${answered} answered · ${attempt.review.length} marked for review · ${attempt.keys.length - answered} not answered`;
  submitDialog.showModal();
});
submitDialog.addEventListener('close', () => {
  const choice = submitDialog.returnValue;
  submitDialog.returnValue = '';
  if (choice === 'submit') finish();
});

$('[data-abandon]').addEventListener('click', () => abandonDialog.showModal());
abandonDialog.addEventListener('close', () => {
  const choice = abandonDialog.returnValue;
  abandonDialog.returnValue = '';
  if (choice !== 'abandon') return;
  stopTimer();
  flushTime();
  if (!mutate((a, now) => abandonAttempt(a, now))) return;
  finished = true;
  document.dispatchEvent(new CustomEvent('sawaalbox:test'));
  location.assign('/upsc/test');
});

// --- Starting. ---

async function begin() {
  nameEl.textContent = attemptName(attempt);
  drawBar();
  submitBtn.disabled = true;
  show('loading');
  say(`Loading ${attempt.keys.length} questions…`);
  if (!(await loadQuestions())) {
    say("The questions didn't load. Check your connection, then try again.", { error: true });
    retryRow.hidden = false;
    return;
  }
  retryRow.hidden = true;
  say(saveFailed ? NOT_SAVED : '', { error: saveFailed });
  buildGrid();
  fitGrid();
  render();
  show('test');
  // render() ran while the test was hidden, with nothing laid out to scroll.
  keepInView(cells[attempt.current].button);
  submitBtn.disabled = false;
  announce(`Question ${attempt.current + 1} of ${attempt.keys.length}`);
  startClock();
}

function retry() {
  if (page.dataset.view === 'loading' && !retryRow.hidden) begin();
}
$('[data-retry]').addEventListener('click', retry);
window.addEventListener('online', retry);

function openAttempt(id) {
  const stored = getAttempt(loadTests(), id);
  if (!stored) {
    message("This test isn't on this device.");
    // Signed in, the account may hold it: a sync that brings it opens it.
    const arrive = () => {
      if (!getAttempt(loadTests(), id)) return;
      document.removeEventListener('sawaalbox:synced', arrive);
      openAttempt(id);
    };
    document.addEventListener('sawaalbox:synced', arrive);
    return;
  }
  if (stored.status === 'submitted') return location.replace(resultUrl(id));
  if (stored.status === 'abandoned') return message("You abandoned this test. Its answers are kept, but it doesn't count in your results.");
  attempt = stored;
  begin();
}

function offerPaper(year) {
  const existing = inProgressPaper(loadTests(), year);
  if (existing) {
    history.replaceState(null, '', `?attempt=${encodeURIComponent(existing.id)}`);
    attempt = existing;
    return begin();
  }
  const info = PAPERS.find((p) => p.year === year);
  nameEl.textContent = `UPSC Prelims ${year}`;
  $('[data-start-facts]').textContent = `${info.questions} questions · 2 hours`;
  $('[data-start-notes]').replaceChildren(
    ...info.notes.map((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    })
  );
  show('start');
  const startBtn = $('[data-start-button]');
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    say('');
    const path = `/upsc/full/${year}.json`;
    if (!(await canStartTest('upsc'))) {
      say("Tests aren't open to this account.", { error: true });
      startBtn.disabled = false;
      return;
    }
    if (!files.has(path) && !(await fetchYear(path))) {
      say("The paper didn't load. Check your connection, then try again.", { error: true });
      startBtn.disabled = false;
      return;
    }
    const fresh = newAttempt({
      id: newId(),
      kind: 'paper',
      spec: { year },
      keys: paperKeys(year, files.get(path)),
      limitMs: PAPER_MINUTES * MINUTE,
      now: iso(),
    });
    attempt = fresh;
    saveFailed = !saveTests(putAttempt(loadTests(), fresh));
    history.replaceState(null, '', `?attempt=${encodeURIComponent(fresh.id)}`);
    document.dispatchEvent(new CustomEvent('sawaalbox:test'));
    begin();
  });
}

// The questions and the bar are set in Courier Prime in part; drawn before the
// face is ready they would move when it swaps in. The same goes for Literata
// (the question, the rules) and Archivo (the head, the buttons): a cold load
// can draw the start screen in the fallback and rewrap it when they land. Wait
// for all of them, briefly.
const FACES = ['400 1em "Courier Prime"', '700 1em "Courier Prime"', '400 1em Literata', '700 1em "Archivo Variable"'];
function fontsReady() {
  if (!document.fonts?.load) return Promise.resolve();
  const faces = Promise.all(FACES.map((font) => document.fonts.load(font)));
  return Promise.race([faces, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).catch(() => {});
}

fontsReady().then(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('attempt');
  const year = Number(params.get('paper'));
  if (id) openAttempt(id);
  else if (PAPERS.some((p) => p.year === year)) offerPaper(year);
  else message('Choose a paper, or build a practice set, to start a test.');
});
