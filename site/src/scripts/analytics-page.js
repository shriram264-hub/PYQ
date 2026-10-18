import { examRules } from '../lib/exam-rules.js';
import { canSeeAnalytics } from '../lib/tests/access.js';
import { parseCatalogue } from '../lib/tests/catalogue.js';
import { MIN_ANSWERED, breakdown, headline, paperHistory, submittedFor } from '../lib/tests/analytics.js';
import { MAX_ATTEMPTS, TESTS_KEY, loadTests } from '../lib/tests/store.js';
import { formatDate, formatScore } from '../lib/tests/score.js';
import { STORAGE_KEY, loadState } from '../lib/accounts/progress-store.js';
import { slugify } from '../lib/question-html.js';
import { SUPABASE_URL, firstSyncHere, sessionHint, storageKeyFor, storedUserId } from '../lib/accounts/config.js';
import { deviceOwner } from '../lib/accounts/pull.js';

// "Your analytics" (spec 2026-10-18-analytics-design.md, section 1): this
// device's submitted tests and marks, in the agreed order. The headline numbers
// and the papers chart come from the attempts' stored results alone, so they are
// drawn at once; By subject, Topics to work on and Questions you got wrong need
// the question catalogue, and are drawn below them once it is in, with the
// colophon out of the page until then (data-settling; see analytics.astro).
//
// Nothing here names an exam: it is the page's data-exam, its marking comes from
// lib/exam-rules.js, and every address is built from it. Everything from storage
// or the catalogue goes in with textContent (or as a text node); the chart is
// SVG built with DOM methods.

const FILE_TIMEOUT_MS = 15000;
const FONT_WAIT_MS = 3000;
const FIRST_SYNC_HOLD_MS = 2500;
const MINUS = '−';

// The chart, in CSS pixels: it is drawn at the width it is shown at, so its
// type is the page's size at any width. `step` is the least room between two
// papers, enough for one score ("118.67") not to run into the next.
const CHART = { height: 200, top: 30, right: 16, bottom: 34, left: 48, step: 60, inset: 32 };
const SVG_NS = 'http://www.w3.org/2000/svg';

const $ = (selector) => document.querySelector(selector);
const sheet = $('main[data-exam]');
const exam = sheet.dataset.exam;
const rules = examRules(exam);

const PATHS = {
  catalogue: `/${exam}/catalogue.json`,
  tests: `/${exam}/test`,
  papers: `/${exam}/test#papers`,
  wrong: `/revise?wrong=${encodeURIComponent(exam)}`,
};
const practisePath = (subject, topic) =>
  `${PATHS.tests}?subject=${slugify(subject)}${topic === undefined ? '' : `&topic=${slugify(topic)}`}#practice`;

const title = $('#an-title');
const fromEl = $('[data-from]');
const cappedEl = $('[data-capped]');
const lockedEl = $('[data-locked]');
const emptyEl = $('[data-empty]');
const emptyText = $('[data-empty-text]');
const headlineSection = $('[data-headline-section]');
const cells = $('[data-cells]');
const papersSection = $('[data-papers-section]');
const chart = $('[data-chart]');
const chartNote = $('[data-chart-note]');
const papersRows = $('[data-papers-rows]');
const note = $('[data-note]');
const retryRow = $('[data-retry-row]');
const retryButton = $('[data-retry]');
const subjectsSection = $('[data-subjects-section]');
const subjectsTitle = $('[data-subjects-title]');
const subjectsLede = $('[data-subjects-lede]');
const subjectsList = $('[data-subjects]');
const topicsSection = $('[data-topics-section]');
const topicsLede = $('[data-topics-lede]');
const topicsList = $('[data-topics]');
const wrongSection = $('[data-wrong-section]');
const wrongBox = $('[data-wrong]');

$('[data-tests-link]').href = PATHS.tests;

// --- Small makers. Strings are appended as text nodes, never parsed. ---

function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}
function link(className, href, ...children) {
  const a = el('a', className, ...children);
  a.href = href;
  return a;
}
const unseen = (text) => el('span', 'visually-hidden', text);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const percent = (part, whole) => Math.round((100 * part) / whole);
const withMinus = (text) => text.replace(/^-/, MINUS);
const signed = (n) => (n > 0 ? `+${formatScore(n)}` : n < 0 ? `${MINUS}${formatScore(-n)}` : formatScore(0));
const shareText = (n) => withMinus(`${n}%`);

// Set only when it differs. A storage event lands here every 5 s while a test
// runs in another tab; writing the same value again would still be a change to
// the page (a mutation, and for a live region possibly an announcement).
const show = (node, on) => {
  if (node.hidden === on) node.hidden = !on;
};
const setText = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};

// --- What this device holds. ---

// A question key names its exam first (questionKey in lib/accounts/qkey.js):
// `${exam}-${year}-${number}`.
const ofExam = (key) => key.startsWith(`${exam}-`);

/**
 * The page's state, from storage alone:
 *   'tests'   this exam has submitted tests on this device;
 *   'marks'   none, but questions marked Done or Needs review;
 *   'nothing' neither (and so also for an exam with no marking rules).
 * Blocked or unreadable storage reads as empty (loadTests, loadState).
 */
function read() {
  const tests = loadTests();
  const marks = loadState().entries;
  const attempts = submittedFor(tests, exam);
  const marked = Object.keys(marks).some(ofExam);
  const state = !rules ? 'nothing' : attempts.length ? 'tests' : marked ? 'marks' : 'nothing';
  return { state, attempts, marks, capped: Object.keys(tests.attempts).length >= MAX_ATTEMPTS };
}

// --- The catalogue (the /revise loader: a time limit, Try again, online). ---

const catalogue = { status: 'idle', data: null, promise: null }; // idle | loading | loaded | failed

function loadCatalogue() {
  if (catalogue.status === 'loading' || catalogue.status === 'loaded') return catalogue.promise;
  catalogue.status = 'loading';
  catalogue.promise = (async () => {
    // A controller and a timer rather than AbortSignal.timeout, which older
    // Safari lacks: without a limit a stalled request would hold the sections,
    // and the colophon behind them, for ever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
    try {
      const response = await fetch(PATHS.catalogue, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const parsed = parseCatalogue(await response.json(), exam);
      if (!parsed) throw new Error('not a catalogue');
      catalogue.data = parsed;
      catalogue.status = 'loaded';
    } catch {
      // Offline, too slow, or not a catalogue: the note says so, with Try again.
      catalogue.status = 'failed';
    } finally {
      clearTimeout(timer);
    }
  })();
  return catalogue.promise;
}

function startLoading() {
  if (catalogue.status !== 'idle') return;
  loadCatalogue().then(() => {
    if (shown) render();
  });
}

// breakdown() walks every attempt and the whole catalogue. Its inputs are the
// submitted attempts (which never change once submitted) and the marks, so it
// is worked out again only when one of those has.
let memo = { key: null, value: null };
function breakdownOf(view) {
  const marks = Object.entries(view.marks)
    .filter(([key]) => ofExam(key))
    .map(([key, m]) => [key, m.status, m.updatedAt]);
  const key = JSON.stringify([view.attempts.map((a) => a.id), marks]);
  if (memo.key !== key) memo = { key, value: breakdown(view.attempts, view.marks, catalogue.data, rules, exam) };
  return memo.value;
}

// --- Drawing. Each part is drawn again only when what it shows has changed:
// its signature is the JSON of the numbers it shows. A test running in another
// tab saves its clock every 5 s; that changes no submitted attempt, so no part,
// and the page is left exactly as it is. ---

const drawn = new Map();
function part(name, value, draw) {
  const signature = JSON.stringify(value);
  if (drawn.get(name) === signature) return;
  drawn.set(name, signature);
  draw(value);
}

// Rebuilding a list under a keyboard user would drop their focus: it goes back
// to the same link in the rebuilt list, or to the section's heading.
function keepFocus(container, rebuild) {
  const active = document.activeElement;
  const had = container.contains(active);
  const key = had ? active.dataset?.focus : undefined;
  rebuild();
  if (!had) return;
  const again = key && [...container.querySelectorAll('[data-focus]')].find((n) => n.dataset.focus === key);
  const heading = container.closest('section')?.querySelector('h2[tabindex]');
  (again || (heading && !heading.closest('[hidden]') ? heading : null) || title).focus();
}

function fromLine({ tests, papers }) {
  const sets = tests - papers;
  const parts = [];
  if (papers) parts.push(plural(papers, 'full paper', 'full papers'));
  if (sets) parts.push(plural(sets, 'practice set', 'practice sets'));
  return `From ${plural(tests, 'submitted test', 'submitted tests')}: ${parts.join(' and ')}.`;
}

function drawHead({ counts, capped }) {
  show(fromEl, Boolean(counts));
  setText(fromEl, counts ? fromLine(counts) : '');
  show(cappedEl, capped);
  setText(cappedEl, capped ? `Covers your latest ${MAX_ATTEMPTS} tests.` : '');
}

const EMPTY = {
  nothing:
    'Your analytics fills in as you take practice tests: your scores over time, your accuracy, and the subjects and topics to work on.',
  marks:
    "Your analytics fills in as you take practice tests. Until then, By subject shows how much of each subject you've covered by marking questions Done or Needs review.",
};

function drawEmpty(state) {
  show(emptyEl, Boolean(state));
  setText(emptyText, state ? EMPTY[state] : '');
}

// One field of the headline box: its label, a figure, and a line saying what
// the figure is made of.
function cell(label, figure, ...detail) {
  const box = el('div', 'an-cell', el('dt', 'field-label', label));
  if (figure) box.append(el('dd', 'an-value', ...figure));
  box.append(el('dd', 'an-detail', ...detail));
  return box;
}

function changeLine({ year, change }) {
  const which = `${year} paper`;
  if (change === null) return which;
  if (change === 0) return `${which}, the same score as the paper before`;
  return `${which}, ${signed(change)} on the paper before`;
}

function drawHeadline(h) {
  show(headlineSection, Boolean(h));
  if (!h) {
    cells.replaceChildren();
    return;
  }
  const latest = h.latestPaper;
  const sit = link('', PATHS.papers, 'Sit a past paper');
  sit.dataset.focus = 'papers';
  const paper = latest
    ? cell('Latest paper', [withMinus(formatScore(latest.score)), ofMax(latest.max)], changeLine(latest))
    : cell('Latest paper', null, 'No full paper yet. ', sit);
  const { right, answered } = h.accuracy;
  const { blank, scored } = h.blank;
  const wrong = answered - right;
  keepFocus(cells, () => cells.replaceChildren(
    paper,
    answered
      ? cell('Accuracy', [`${percent(right, answered)}%`], `${right} right of ${answered} answered`)
      : cell('Accuracy', ['None'], 'No questions answered yet'),
    scored
      ? cell('Left blank', [`${percent(blank, scored)}%`], `${blank} of ${scored} questions`)
      : cell('Left blank', ['None'], 'No scored questions yet'),
    cell(
      'Lost to wrong answers',
      [h.lost > 0 ? `${MINUS}${formatScore(h.lost)}` : formatScore(0)],
      `marks, from ${plural(wrong, 'wrong answer', 'wrong answers')}`
    )
  ));
}

// "/ 200", read by a screen reader as "out of 200".
function ofMax(max) {
  const slash = el('span', '', ' / ');
  slash.setAttribute('aria-hidden', 'true');
  return el('span', 'an-of', slash, unseen(' out of '), String(max));
}

// --- The papers chart. ---

function svg(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Each paper as a share of its own maximum (pre-2011 papers are out of 300), labelled with its score. */
function chartSvg(history, width) {
  const { height, top, right, bottom, left, step, inset } = CHART;
  const n = history.length;
  const shares = history.map((p) => (100 * p.score) / p.max);
  // Negative marking can take a paper below zero: the scale then reaches down
  // to the quarter under it.
  const low = Math.min(0, Math.floor(Math.min(...shares) / 25) * 25);
  const plotW = Math.max(width - left - right, (n - 1) * step + 2 * inset);
  const plotH = height - top - bottom;
  const w = left + plotW + right;
  // The first and last papers stand in from the scale's ends, so a score label
  // never sits on the percentages beside it.
  const x = (i) => (n === 1 ? left + plotW / 2 : left + inset + (i * (plotW - 2 * inset)) / (n - 1));
  const y = (share) => top + ((100 - share) / (100 - low)) * plotH;
  const round = (v) => Math.round(v * 10) / 10;

  const root = svg('svg', { width: w, height, viewBox: `0 0 ${w} ${height}`, 'aria-hidden': 'true', focusable: 'false' });
  for (const tick of new Set([low, 0, 50, 100])) {
    const at = round(y(tick));
    root.append(
      svg('line', { class: tick === 0 ? 'an-base' : 'an-grid', x1: left, x2: left + plotW, y1: at, y2: at }),
      svg('text', { class: 'an-tick', x: left - 12, y: at, 'text-anchor': 'end', 'dominant-baseline': 'middle' }, shareText(tick))
    );
  }
  if (n > 1) {
    root.append(svg('polyline', { class: 'an-line', points: shares.map((s, i) => `${round(x(i))},${round(y(s))}`).join(' ') }));
  }
  history.forEach((p, i) => {
    const cx = round(x(i));
    const cy = round(y(shares[i]));
    root.append(
      svg('rect', { class: 'an-point', x: cx - 4, y: cy - 4, width: 8, height: 8 }),
      svg('text', { class: 'an-score', x: cx, y: cy - 11, 'text-anchor': 'middle' }, withMinus(formatScore(p.score))),
      svg('text', { class: 'an-year', x: cx, y: height - 12, 'text-anchor': 'middle' }, String(p.year))
    );
  });
  return root;
}

let chartHistory = [];
let chartWidth = 0;

// Drawn at the width it has. With more papers than fit, the drawing is wider
// than its box, which scrolls; it opens at the latest paper, and takes focus so
// a keyboard can scroll it.
function drawChart() {
  if (!chartHistory.length) {
    chart.replaceChildren();
    chartWidth = 0;
    return;
  }
  chartWidth = chart.clientWidth;
  chart.replaceChildren(chartSvg(chartHistory, chartWidth));
  if (chart.scrollWidth > chart.clientWidth + 1) {
    chart.tabIndex = 0;
    chart.setAttribute('role', 'group');
    chart.setAttribute('aria-label', 'Chart of your full papers, scrolls sideways');
    chart.scrollLeft = chart.scrollWidth;
  } else {
    chart.removeAttribute('tabindex');
    chart.removeAttribute('role');
    chart.removeAttribute('aria-label');
  }
}

function paperRow(p) {
  const head = el('th', '', `${p.year} paper`);
  head.scope = 'row';
  return el(
    'tr',
    '',
    head,
    el('td', '', formatDate(p.submittedAt)),
    el('td', '', `${withMinus(formatScore(p.score))} out of ${p.max}`),
    el('td', '', shareText(percent(p.score, p.max)))
  );
}

function drawPapers(history) {
  show(papersSection, history.length > 0);
  papersRows.replaceChildren(...history.map(paperRow));
  show(chartNote, history.length === 1);
  setText(chartNote, history.length === 1 ? 'One full paper so far. Sit another to see how your score moves.' : '');
  chartHistory = history;
  drawChart();
}

// --- By subject, topics, wrong answers: once the catalogue is in. ---

const SUBJECTS_LEDE = `Lowest accuracy first, among subjects where you've answered at least ${MIN_ANSWERED} questions; those with fewer answers follow. Covered counts the questions you've answered in a test or marked Done or Needs review.`;
const COVERAGE_LEDE = "The questions you've marked Done or Needs review, out of each subject's total.";

function subjectRow(r, tests) {
  const name = el('span', 'an-row-name', r.subject);
  let meter = null;
  if (r.answered >= MIN_ANSWERED) {
    const share = percent(r.right, r.answered);
    const fill = el('span', 'an-bar-fill');
    fill.style.width = `${share}%`;
    const bar = el('span', 'an-bar', fill);
    bar.setAttribute('aria-hidden', 'true');
    meter = el('span', 'an-meter', bar, el('span', 'an-pct', `${share}% right`));
  } else if (r.answered > 0) {
    // A percentage from one or two answers would read as a verdict.
    meter = el('span', 'an-meter', el('span', 'an-few', `${r.right} of ${r.answered} right so far`));
  } else if (tests) {
    meter = el('span', 'an-meter', el('span', 'an-none', 'No answers in a test yet'));
  }
  const coverage = `Covered ${r.covered} of ${r.total}`;
  const facts =
    r.answered > 0 ? `${r.answered} answered · Net marks ${signed(r.net)} · ${coverage}` : coverage;
  const practise = link('an-link', practisePath(r.subject), 'Practise', unseen(` ${r.subject}`));
  practise.dataset.focus = `subject\u0000${r.subject}`;
  const row = el('li', meter ? 'an-row an-subject' : 'an-row an-subject an-row-bare', name, ' ');
  if (meter) row.append(meter, ' ');
  row.append(el('span', 'an-facts', facts), ' ', practise);
  return row;
}

function drawSubjects(value) {
  show(subjectsSection, Boolean(value));
  if (!value) {
    subjectsList.replaceChildren();
    return;
  }
  setText(subjectsTitle, value.tests ? 'By subject, weakest first' : 'By subject');
  setText(subjectsLede, value.tests ? SUBJECTS_LEDE : COVERAGE_LEDE);
  keepFocus(subjectsList, () => subjectsList.replaceChildren(...value.rows.map((r) => subjectRow(r, value.tests))));
}

function topicRow(t) {
  const name = el('span', 'an-row-name', t.topic, el('span', 'an-row-sub', unseen(', in '), t.subject));
  const meter = el('span', 'an-meter', el('span', 'an-few', `${t.right} of ${t.answered} right`));
  // A label rather than hidden words after the visible ones: Chrome's name for
  // the link put a space before the hidden text's colon ("Practise this topic :
  // …"). It starts with the words on screen, so speaking them finds the link.
  const practise = link('an-link', practisePath(t.subject, t.topic), 'Practise this topic');
  practise.setAttribute('aria-label', `Practise this topic: ${t.topic}`);
  practise.dataset.focus = `topic\u0000${t.subject}\u0000${t.topic}`;
  return el('li', 'an-row an-topic', name, ' ', meter, ' ', practise);
}

function drawTopics(topics) {
  show(topicsSection, topics !== null);
  if (topics === null) {
    topicsList.replaceChildren();
    return;
  }
  setText(
    topicsLede,
    topics.length
      ? `Your lowest accuracy, among topics where you've answered at least ${MIN_ANSWERED} questions.`
      : `Answer at least ${MIN_ANSWERED} questions in a topic to see it here.`
  );
  show(topicsList, topics.length > 0);
  keepFocus(topicsList, () => topicsList.replaceChildren(...topics.map(topicRow)));
}

function drawWrong(count) {
  show(wrongSection, count !== null);
  if (count === null) {
    wrongBox.replaceChildren();
    return;
  }
  if (count === 0) {
    keepFocus(wrongBox, () => wrongBox.replaceChildren(el('p', '', 'No wrong answers to revise.')));
    return;
  }
  const words = el(
    'div',
    '',
    el('p', '', el('span', 'an-count', String(count)), ` ${count === 1 ? 'question' : 'questions'} you last answered wrong.`),
    el('p', 'an-wrong-hint', "Revise shows the newest first. Mark one Done once you've learnt it, and it leaves the list.")
  );
  const revise = link('an-btn', PATHS.wrong, 'Revise them');
  revise.dataset.focus = 'wrong';
  keepFocus(wrongBox, () => wrongBox.replaceChildren(words, revise));
}

// --- The catalogue's status line, Try again, and the colophon. ---

const LOADING = 'Loading your subjects and topics…';
const FAILED = "Couldn't load your subjects and topics. Check your connection, then try again.";

let shown = false; // the first draw is done
let framed = false; // and has been on screen for a frame (see settle)
let wants = false; // what is shown needs the catalogue
let retrying = false;

// The colophon is out of the page (data-settling) while the catalogue is on its
// way. The first draw takes it out whatever the catalogue's state, and it comes
// back no sooner than the frame after: while the page was pending it was laid
// out, unseen, where the short unfilled page ended, and shown straight from
// there Chrome would count its move to the foot of the drawn page as a shift.
function settle() {
  if (wants && catalogue.status === 'loading') sheet.toggleAttribute('data-settling', true);
  else if (framed) sheet.removeAttribute('data-settling');
}

function drawStatus() {
  const loading = wants && catalogue.status === 'loading';
  const failed = wants && catalogue.status === 'failed';
  const busy = loading && retrying;
  show(note, wants);
  setText(note, loading ? LOADING : failed ? FAILED : '');
  note.toggleAttribute('data-boxed', failed || busy);
  show(retryRow, failed || busy);
  setText(retryButton, busy ? 'Loading…' : 'Try again');
  if (busy) retryButton.setAttribute('aria-disabled', 'true');
  else retryButton.removeAttribute('aria-disabled');
  settle();
}

function render() {
  const view = read();
  const { state } = view;
  const tests = state === 'tests';
  const counts = tests ? { tests: view.attempts.length, papers: view.attempts.filter((a) => a.kind === 'paper').length } : null;
  part('head', { counts, capped: tests && view.capped }, drawHead);
  part('empty', tests ? null : state, drawEmpty);
  part('headline', tests ? headline(view.attempts, rules) : null, drawHeadline);
  part('papers', tests ? paperHistory(view.attempts) : [], drawPapers);

  wants = state !== 'nothing';
  if (wants) startLoading();
  const b = wants && catalogue.status === 'loaded' ? breakdownOf(view) : null;
  part('subjects', b && b.subjects.length ? { tests, rows: b.subjects } : null, drawSubjects);
  part('topics', b && tests ? b.topics : null, drawTopics);
  part('wrong', b && tests ? b.wrong.length : null, drawWrong);
  drawStatus();
}

// Try again, and a connection that comes back. While it fetches, the note
// stays framed and Try again says Loading; the sections arrive below with the
// colophon out of the page, so nothing the reader can see moves.
async function retry() {
  if (!shown || retrying || catalogue.status !== 'failed') return;
  retrying = true;
  const hadFocus = retryRow.contains(document.activeElement);
  const loading = loadCatalogue();
  render();
  await loading;
  retrying = false;
  render();
  if (hadFocus && retryRow.hidden) {
    const heading = [subjectsSection, topicsSection, wrongSection].find((s) => !s.hidden)?.querySelector('h2');
    (heading ?? title).focus();
  }
}

retryButton.addEventListener('click', () => {
  if (retryButton.getAttribute('aria-disabled') !== 'true') retry();
});
window.addEventListener('online', retry);

// --- The first draw. ---

// It shows the page (analytics.astro keeps it hidden until then), so it waits
// for three things.
//
// The faces: the numbers are set in Courier Prime and the rows in Archivo and
// Literata. Shown before a face is ready, a row rewraps when it swaps in, so the
// first draw waits for them, briefly, as the tests and results pages do.
const FACES = ['400 1em "Courier Prime"', '700 1em "Courier Prime"', '400 1em Literata', '700 1em "Archivo Variable"'];
function fontsReady() {
  if (!document.fonts?.load) return Promise.resolve();
  const faces = Promise.all(FACES.map((font) => document.fonts.load(font)));
  return Promise.race([faces, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).catch(() => {});
}

// The first sync. A signed-in visitor on a device that has never held their
// account's data is about to have attempts and marks arrive, which would fill
// the page in under them. The first draw waits for that sync, as /account and
// the tests page do, for at most FIRST_SYNC_HOLD_MS. A returning device has its
// data already, and is not held; nor is a session the masthead control has
// found to be over (data-auth="out"). With sign-in switched off SUPABASE_URL is
// '' and storageKeyFor('') throws, so the catch leaves `held` false.
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

// And the access check: analytics is free during the beta (canSeeAnalytics),
// and is drawn only once the check says yes. A check that fails says no.
const allowed = canSeeAnalytics(exam).then(
  (ok) => ok === true,
  () => false
);

// The catalogue does not wait for the faces or the sync: asked for after them
// it would add its own time to theirs. When this device has something it is
// needed for, it is asked for as soon as the check allows.
allowed.then((ok) => {
  if (ok && read().state !== 'nothing') startLoading();
});

Promise.all([fontsReady(), firstSync, allowed]).then(([, , ok]) => {
  sheet.toggleAttribute('data-settling', true);
  if (ok) {
    shown = true;
    render();
  } else {
    show(lockedEl, true);
  }
  sheet.removeAttribute('data-pending');
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      framed = true;
      settle();
    })
  );
  if (!ok) return;
  // A new width (a turned phone, a resized window) redraws the chart to fit.
  // Its height is fixed, so nothing around it moves.
  new ResizeObserver(() => {
    if (chartHistory.length && chart.clientWidth !== chartWidth) drawChart();
  }).observe(chart);
});

// Storage changed under the page: a sync landed, another tab wrote, or the page
// came back from the back/forward cache. Each part is drawn again only if its
// numbers changed (see part).
const refresh = () => {
  if (shown) render();
};
document.addEventListener('sawaalbox:synced', refresh);
window.addEventListener('storage', (event) => {
  if (event.key === TESTS_KEY || event.key === STORAGE_KEY || event.key === null) refresh();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) refresh();
});
