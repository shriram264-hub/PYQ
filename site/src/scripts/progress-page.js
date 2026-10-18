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
import { subjectsCoveredBy, summarise } from '../lib/accounts/summary.js';
import {
  coverageOf,
  figures,
  oldestLine,
  pickPlan,
  recentTests,
  resumeOf,
  reviewOf,
  weakestOf,
} from '../lib/accounts/dashboard.js';
import { examRules } from '../lib/exam-rules.js';
import { parseCatalogue } from '../lib/tests/catalogue.js';
import { MIN_ANSWERED, breakdown, headline, submittedFor } from '../lib/tests/analytics.js';
import { TESTS_KEY, loadTests } from '../lib/tests/store.js';

// The /account page, My progress. Everything it shows comes from this device's
// storage (a sync keeps that in step with the account), plus the exam's question
// catalogue, which turns stored keys into subjects and topics. Top to bottom:
//   - Pick up where you left off: a test to resume, the Needs review pile, the
//     weakest topic; or, with none of those, a first test.
//   - Your tests and analytics: headline figures, the way to the analytics and
//     the tests, and the latest results. From stored results alone: no catalogue.
//   - Your revision lists: Rename, Delete and Revise.
//   - Coverage by subject, from the catalogue. It is last, so that it growing
//     when the catalogue lands moves nothing but the colophon, which is out of
//     the page until then.
// The catalogue is fetched only when this device has something it is needed
// for: a submitted test, a mark, or a question in a list. A new student fetches
// nothing.
//
// No auth code is imported here: until sign-in is switched on this page must
// not carry any, so Sign in loads auth.js (and through it supabase-js) when it
// is pressed, and the state of the session is read off the masthead control.

// The exam this page reports on. Every address and rule below comes from it.
const EXAM = 'upsc';
const RULES = examRules(EXAM);
const PATHS = {
  tests: `/${EXAM}/test`,
  analytics: `/${EXAM}/analytics`,
  catalogue: `/${EXAM}/catalogue.json`,
  take: (id) => `/${EXAM}/test/take?attempt=${encodeURIComponent(id)}`,
  result: (id) => `/${EXAM}/test/result?attempt=${encodeURIComponent(id)}`,
  review: '/revise?review',
  list: (id) => `/revise?list=${encodeURIComponent(id)}`,
};
// A question key names its exam first (questionKey in lib/accounts/qkey.js).
const ofExam = (key) => key.startsWith(`${EXAM}-`);

const NOT_SAVED = 'Your browser would not save that. Check that it lets this site store data.';
const SIGN_IN_FAILED = 'Could not reach the sign-in service. Your progress on this device is safe.';
// How long the catalogue may take. Past this it counts as failed rather than
// leaving "Loading" up, and the colophon out, for ever on a stalled connection.
const FILE_TIMEOUT_MS = 15000;

// The line the server writes is the dark-launch one, "Kept on this device.".
const WHERE = {
  out: 'Kept on this device. An account keeps your progress and lists on every device.',
  in: 'Signed in. Your progress and lists sync to your account.',
};

const $ = (selector) => document.querySelector(selector);
const acct = $('.acct');
const pickBox = $('[data-pick]');
const testsBox = $('[data-tests]');
const coverageBox = $('[data-coverage]');
const listsBox = $('[data-lists]');
const listsNote = $('[data-lists-note]');
const whereNote = $('[data-where-note]');

const el = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
};
// Everything below is built with textContent or text nodes, never an HTML
// string: a list name is the student's text, a topic is the catalogue's, and
// markup in either must stay inert.
const text = (tag, className, value) => el(tag, className, value);
const link = (className, href, ...children) => {
  const a = el('a', className, ...children);
  a.href = href;
  return a;
};
const unseen = (value) => text('span', 'visually-hidden', value);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Set only when it differs. A test running in another tab saves its clock every
// 5 s and each save lands here: writing the same words again would still be a
// change to the page.
const setText = (node, value) => {
  if (node.textContent !== value) node.textContent = value;
};

// A live region that is always in the page. A failure is shown as well as
// announced (see .acct-note).
function say(note, message, { error = false } = {}) {
  note.textContent = message;
  note.toggleAttribute('data-error', error && Boolean(message));
}

// --- What this device holds. ---

function read() {
  const tests = loadTests();
  const state = loadState();
  const attempts = submittedFor(tests, EXAM);
  const marked = Object.keys(state.entries).some(ofExam);
  const listed = Object.values(state.lists).some((l) => l.keys.some(ofExam));
  return { tests, state, attempts, marked, wants: attempts.length > 0 || marked || listed };
}

// --- The catalogue (as /upsc/analytics loads it: a time limit, and again when
// the connection comes back). ---

const catalogue = { status: 'idle', data: null, subjectOf: null }; // idle | loading | loaded | failed

async function loadCatalogue() {
  catalogue.status = 'loading';
  // A controller and a timer rather than AbortSignal.timeout, which older
  // Safari lacks.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
  try {
    const response = await fetch(PATHS.catalogue, { signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    const parsed = parseCatalogue(await response.json(), EXAM);
    if (!parsed) throw new Error('not a catalogue');
    const subjects = new Map(parsed.entries.map((e) => [e.key, e.subject]));
    catalogue.data = parsed;
    catalogue.subjectOf = (key) => subjects.get(key) ?? null;
    catalogue.status = 'loaded';
  } catch {
    // Offline, too slow, or not a catalogue: the parts that need it say so.
    catalogue.status = 'failed';
  } finally {
    clearTimeout(timer);
  }
  render();
}

const needsCatalogue = (view) => view.wants && (catalogue.status === 'idle' || catalogue.status === 'loading');

// breakdown() walks every attempt and the whole catalogue. Its inputs are the
// submitted attempts (which never change once submitted) and the marks, so it
// is worked out again only when one of those has.
let memo = { key: null, value: null };
function breakdownOf(view) {
  const marks = Object.entries(view.state.entries)
    .filter(([key]) => ofExam(key))
    .map(([key, m]) => [key, m.status, m.updatedAt]);
  const key = JSON.stringify([view.attempts.map((a) => a.id), marks]);
  if (memo.key !== key) memo = { key, value: breakdown(view.attempts, view.state.entries, catalogue.data, RULES, EXAM) };
  return memo.value;
}

// --- Drawing the parts above and below the lists. Each is drawn again only
// when what it shows has changed: its signature is the JSON of what it shows.
// A test running in another tab changes only the Resume card's time left,
// which is written into its line where it stands. ---

const drawn = new Map();
function part(name, value, draw) {
  const signature = JSON.stringify(value);
  if (drawn.get(name) === signature) return;
  drawn.set(name, signature);
  draw(value);
}

// Rebuilding a part under a keyboard user would drop their focus: it goes back
// to the control with the same data-focus in the rebuilt part, or to the
// section's heading.
function keepFocus(container, rebuild) {
  const active = document.activeElement;
  const had = container.contains(active);
  const key = had ? active.dataset?.focus : undefined;
  rebuild();
  if (!had) return;
  const again = key && [...container.querySelectorAll('[data-focus]')].find((n) => n.dataset.focus === key);
  (again ?? container.closest('section')?.querySelector('h2'))?.focus();
}

// A link drawn as a button: the page's one filled-green action, or outlined.
function action(label, href, { primary, focus, aria }) {
  const a = link(primary ? 'acct-primary' : 'acct-btn', href, label);
  a.dataset.focus = focus;
  if (aria) a.setAttribute('aria-label', aria);
  return a;
}

// --- Pick up where you left off. ---

// One card: its heading, a name (up to two lines), a detail line, and an
// action at its foot. The weak card keeps this shape in every state, so its
// height never depends on what it says (see .acct-pick-weak).
function pickCard(kind, heading, name, detail, act) {
  const card = el(
    'article',
    `acct-pick-card acct-pick-${kind}`,
    text('h3', '', heading),
    el('p', 'acct-pick-name', ...name),
    el('p', 'acct-pick-detail', ...detail),
    el('p', 'acct-pick-actions', act)
  );
  card.dataset.card = kind;
  return card;
}

function drawPick({ plan, resume, review }) {
  const cards = [];
  if (resume) {
    const resumeLink = action('Resume', PATHS.take(resume.id), {
      primary: plan.primary === 'resume',
      focus: 'resume',
      aria: `Resume ${resume.name}`,
    });
    // The detail line is written by drawResumeDetail, here and on every change.
    cards.push(pickCard('resume', 'Resume test', [resume.name], [], resumeLink));
  }
  if (review) {
    const count = el('span', 'acct-figure', String(review.count));
    cards.push(
      pickCard(
        'review',
        'Needs review',
        [count, ` ${review.count === 1 ? 'question' : 'questions'} to revise`],
        [oldestLine(review.days) ?? ''],
        action('Revise them', PATHS.review, { focus: 'review', aria: 'Revise your Needs review questions' })
      )
    );
  }
  if (plan.cards.includes('weak')) {
    const practise = action('Practise it', PATHS.tests, { focus: 'weak' });
    cards.push(pickCard('weak', 'Your weakest topic', [], [], practise));
  }
  if (plan.starter) {
    cards.push(
      pickCard(
        'starter',
        'Your first test',
        ['Sit a past paper against the clock, or build a short practice set.'],
        [],
        action('Take your first test', PATHS.tests, { primary: plan.primary === 'starter', focus: 'starter' })
      )
    );
  }
  const row = el('div', 'acct-pick-cards', ...cards);
  const hint = plan.hint
    ? text('p', 'acct-after', "Mark questions Done or Needs review as you read, and they'll show up here.")
    : null;
  keepFocus(pickBox, () => pickBox.replaceChildren(...[row, hint].filter(Boolean)));
  // The rebuilt cards have none of the lines written into them.
  drawn.delete('weak');
}

function drawResumeDetail(resume) {
  const line = pickBox.querySelector('[data-card="resume"] .acct-pick-detail');
  if (line) setText(line, resume.detail);
}

// The weak card's states. Its place is held from the first draw (pickPlan), and
// what goes in it is clipped to the lines the card always has, so it filling in
// when the catalogue lands moves nothing.
const WEAK_TEXT = {
  loading: 'Working out your weakest topic…',
  none: `Answer ${MIN_ANSWERED} questions in a topic to see your weakest here.`,
  failed: "Couldn't load your topics. Check your connection.",
};

function drawWeak(weak) {
  const card = pickBox.querySelector('[data-card="weak"]');
  if (!card) return;
  const name = card.querySelector('.acct-pick-name');
  const detail = card.querySelector('.acct-pick-detail');
  const practise = card.querySelector('[data-focus="weak"]');
  if (weak.state !== 'topic') {
    name.replaceChildren(WEAK_TEXT[weak.state]);
    name.removeAttribute('title');
    detail.replaceChildren('');
    // Kept in the card for its height, out of sight and out of reach.
    practise.toggleAttribute('data-off', true);
    practise.setAttribute('aria-hidden', 'true');
    practise.tabIndex = -1;
    return;
  }
  name.replaceChildren(weak.topic, el('span', 'acct-pick-sub', ' · ', weak.subject));
  name.title = `${weak.topic}, ${weak.subject}`;
  detail.replaceChildren(weak.line);
  practise.href = weak.href;
  practise.setAttribute('aria-label', `Practise ${weak.topic}`);
  practise.removeAttribute('data-off');
  practise.removeAttribute('aria-hidden');
  practise.removeAttribute('tabindex');
}

function weakOf(view) {
  if (!view.attempts.length) return null;
  if (catalogue.status === 'failed') return { state: 'failed' };
  if (catalogue.status !== 'loaded') return { state: 'loading' };
  const weak = weakestOf(breakdownOf(view).topics[0], EXAM);
  return weak ? { state: 'topic', ...weak } : { state: 'none' };
}

// --- Your tests and analytics. ---

// "/ 200", read by a screen reader as "out of 200".
function ofMax(max) {
  const slash = text('span', '', ' / ');
  slash.setAttribute('aria-hidden', 'true');
  return el('span', 'acct-of', slash, unseen(' out of '), String(max));
}

function figureCell({ label, value, max, detail }) {
  const figure = el('dd', 'acct-cell-value', value);
  if (max !== null) figure.append(ofMax(max));
  return el('div', 'acct-cell', text('dt', 'field-label', label), figure, text('dd', 'acct-cell-detail', detail));
}

function recentRow(r) {
  return el(
    'li',
    'acct-recent-row',
    link('acct-recent-name', PATHS.result(r.id), r.name),
    ' ',
    text('span', 'acct-recent-date', r.date),
    ' ',
    el('span', 'serial acct-recent-score', r.score, ofMax(r.max))
  );
}

function drawTests({ figures: cells, recent, primary }) {
  const tests = action('Practice tests', PATHS.tests, { primary: primary === 'tests', focus: 'tests' });
  if (!cells) {
    keepFocus(testsBox, () =>
      testsBox.replaceChildren(
        text('p', 'acct-lede', "You haven't taken a practice test yet. Every past paper is here, timed and scored as UPSC scores it."),
        el('p', 'acct-tests-actions', tests)
      )
    );
    return;
  }
  const analytics = action('Your analytics', PATHS.analytics, { primary: primary === 'analytics', focus: 'analytics' });
  const list = el('ul', 'acct-recent', ...recent.map(recentRow));
  list.setAttribute('aria-labelledby', 'acct-recent-h');
  const heading = text('h3', 'acct-recent-h', 'Latest results');
  heading.id = 'acct-recent-h';
  keepFocus(testsBox, () =>
    testsBox.replaceChildren(
      el('dl', 'acct-cells', ...cells.map(figureCell)),
      el('p', 'acct-tests-actions', analytics, ' ', tests),
      heading,
      list
    )
  );
}

// --- Coverage by subject. ---

const COVERAGE_TEXT = {
  nothing: 'Nothing covered yet. Mark questions Done or Needs review as you read, or take a practice test.',
  loading: 'Loading your subjects…',
  failed: "Couldn't load your subjects. Check your connection; this fills in when you're back online.",
};

function coverageRow({ subject, covered, total }) {
  const fill = el('span', 'acct-bar-fill');
  // At least a sliver for anything covered, so one question in a large subject
  // is not drawn as none. The words beside it give the exact count.
  fill.style.width = `${Math.max(1, Math.round((1000 * covered) / total) / 10)}%`;
  const bar = el('span', 'acct-bar', fill);
  bar.setAttribute('aria-hidden', 'true');
  return el(
    'li',
    'acct-cov-row',
    text('span', 'acct-cov-name', subject),
    ' ',
    bar,
    ' ',
    el('span', 'acct-cov-count', text('span', 'serial', String(covered)), ' of ', text('span', 'serial', String(total)))
  );
}

function drawCoverage(value) {
  if (value.state !== 'rows') {
    coverageBox.replaceChildren(text('p', 'acct-empty', COVERAGE_TEXT[value.state]));
    return;
  }
  const rows = el('ol', 'acct-cov', ...value.rows.map(coverageRow));
  rows.setAttribute('aria-labelledby', 'acct-cov-h');
  coverageBox.replaceChildren(
    text('p', 'acct-lede', "Questions you've marked Done or Needs review, or answered in a test, out of each subject's total."),
    rows
  );
  if (value.more) coverageBox.append(text('p', 'acct-after', `+ ${plural(value.more, 'more subject', 'more subjects')}`));
}

function coverageValue(view) {
  if (!view.wants) return { state: 'nothing' };
  if (catalogue.status === 'failed') return { state: 'failed' };
  if (catalogue.status !== 'loaded') return { state: 'loading' };
  const c = coverageOf(breakdownOf(view).bySubject);
  return c.rows.length ? { state: 'rows', ...c } : { state: 'nothing' };
}

// --- Your revision lists. ---

// What the person has open on a card. Drawing replaces the cards wholesale (a
// sync or the catalogue arriving redraws them), so it is kept here and not on
// the nodes: the name being typed, and the list waiting on a Delete confirmation.
const ui = {
  // { id, value, error }: the list being renamed, the name as typed so far, and
  // what is wrong with it ('' for nothing). The error stays until the next edit.
  edit: null,
  confirm: null, // the id of the list whose Delete is waiting for a yes
};

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

// "Indian Polity · Indian Economy · +2 more", from the catalogue. Empty while
// it is on its way (the line is there, so the card does not grow when it
// fills), if it did not load, and for questions it does not know.
function subjectsLine(keys) {
  const line = el('p', 'acct-subjects');
  if (catalogue.status !== 'loaded') return line;
  const { top, more } = subjectsCoveredBy(keys, catalogue.subjectOf);
  if (!top.length) return line;
  // Two parts so a long subject gives way with an ellipsis and "+k more" stays.
  line.append(text('span', 'acct-subjects-top', top.join(' · ')));
  if (more) line.append(text('span', 'acct-subjects-more', ` · +${more} more`));
  line.title = line.textContent;
  return line;
}

// One list's card: its name and count, the subjects it covers, then Revise,
// Rename and Delete (or the rename form, or the Delete question).
function drawCard({ id, name, keys }) {
  const n = keys.length;
  const editing = ui.edit?.id === id;
  const confirming = !editing && ui.confirm === id;

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
  card.append(n ? subjectsLine(keys) : text('p', 'acct-empty', 'No questions yet: use Save to list on any question.'));

  if (editing) return card;
  if (confirming) {
    card.append(confirmBox({ id, name, keys }));
    return card;
  }
  const actions = el('div', 'acct-actions');
  if (n) {
    const revise = control('a', 'acct-btn', 'Revise', { id, fid: 'revise', aria: `Revise "${name}"` });
    revise.href = PATHS.list(id);
    actions.append(revise);
  }
  actions.append(
    control('button', 'acct-text-btn', 'Rename', { act: 'rename', id, fid: 'rename', aria: `Rename "${name}"` }),
    control('button', 'acct-text-btn', 'Delete', { act: 'delete', id, fid: 'delete', aria: `Delete "${name}"` })
  );
  card.append(actions);
  return card;
}

// The lists A to Z. The Revise links are built here and nowhere in the server's
// HTML, so the build never sees them. (Needs review has its card at the top of
// the page.)
function drawLists(lists) {
  const cards = lists.map(drawCard);
  if (!lists.length) cards.push(text('p', 'acct-empty', 'No lists yet: use Save to list on any question.'));

  // The card being renamed, while the person is in its form: a redraw (a sync,
  // the catalogue arriving) must leave it in the page, or the field loses the
  // focus and a phone's keyboard closes mid-word. Everything around it is
  // replaced; its count and subjects are refreshed in place. Only while that
  // form is still the one being edited: Rename activated on another card
  // (without the focus leaving the field) makes ui.edit point there, and keeping
  // this form would leave a dead one beside the new one, and a second
  // #EDIT_INPUT.
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

// --- Showing the page. ---

// The page's body is hidden (account.astro) until its first draw, and the
// colophon is out of the page until the catalogue has settled as well:
// Coverage by subject is the one part whose height nothing can predict, and it
// is the last thing before the colophon. Only the first load holds the
// colophon back. Later draws (a sync, another tab) change what is on screen
// anyway, and must not take the footer away.
//
// The first reveal waits for:
//   - the faces. The figures are set in Courier Prime and the cards in Archivo
//     and Literata; shown before a face is ready, a line rewraps when it swaps
//     in. So it waits for them, briefly, as /upsc/test and /upsc/analytics do.
//   - the first sync. A signed-in visitor on a device that has never held their
//     account's data (see firstSyncHere) is about to have lists, marks and
//     tests arrive, which would push down whatever is already showing. So the
//     first reveal waits for that sync to end (sawaalbox:sync-done, whatever
//     the outcome), for at most FIRST_SYNC_HOLD_MS: a slow sync shows the page
//     as it is rather than nothing. A returning device has its data already,
//     and is not held.
const FIRST_SYNC_HOLD_MS = 2500;
const FONT_WAIT_MS = 3000;
const FACES = ['400 1em "Courier Prime"', '700 1em "Courier Prime"', '400 1em Literata', '700 1em "Archivo Variable"'];
const holds = new Set(['fonts']);
let shown = false; // the first reveal is done
let framed = false; // and has been on screen for a frame (see settle)
let colophonHeld = true; // until the first load has settled
let landed = false;

function fontsReady() {
  if (!document.fonts?.load) return Promise.resolve();
  const faces = Promise.all(FACES.map((font) => document.fonts.load(font)));
  return Promise.race([faces, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).catch(() => {});
}

// /account#lists (the account menu's "My lists", a bookmark): the browser
// scrolls to the section but puts no focus there, so a keyboard or screen
// reader user would start again from the top of the page. The lists heading
// takes focus instead (tabindex=-1). It cannot while the body is hidden
// (data-pending), so the first reveal does it, and only if the person has not
// already moved on to something else; a hash change after that is a deliberate
// move and always lands.
//
// On a load it also has to wait for the load event: Chrome handles the fragment
// itself once the document is parsed, and as the page finishes loading, and
// clears the focus when the target (a section) cannot take it, which undid a
// focus set at the first reveal within a few milliseconds (measured). The
// timeout lets that last pass go first.
function landOnLists(always = false) {
  if (location.hash !== '#lists') return;
  if (!always && document.activeElement !== document.body && document.activeElement !== null) return;
  document.getElementById(LISTS_HEADING)?.focus();
}

function landOnListsAfterLoad() {
  if (document.readyState === 'complete') landOnLists();
  else window.addEventListener('load', () => setTimeout(landOnLists), { once: true });
}

// The colophon comes back once the catalogue this device needs has settled,
// and no sooner than a frame after the first reveal: while the page was
// pending it was laid out, unseen, where the unfilled page ended, and shown
// straight from there Chrome would count its move to the foot of the drawn page
// as a shift. display: none (data-settling) has no old place to move from.
function settle(view) {
  if (!shown || !colophonHeld) return;
  if (!framed || needsCatalogue(view)) {
    acct.toggleAttribute('data-settling', true);
    return;
  }
  acct.removeAttribute('data-settling');
  colophonHeld = false;
}

function reveal() {
  if (shown || holds.size) return;
  shown = true;
  // The browser scrolled to #lists while the page was hidden, before the parts
  // above the lists were drawn. A browser with scroll anchoring kept the lists
  // in place; one without (Safari) is left short of them. So the section is put
  // in view, at once, before the page shows, as /upsc/test does for #practice.
  if (location.hash === '#lists') document.getElementById('lists')?.scrollIntoView();
  acct.toggleAttribute('data-settling', true);
  acct.removeAttribute('data-pending');
  if (!landed) {
    landed = true;
    landOnListsAfterLoad();
  }
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      framed = true;
      settle(read());
    })
  );
}

function release(name) {
  if (!holds.delete(name)) return;
  // Drawn again first: a sync that has just landed changed what there is.
  render();
}

const GONE_ELSEWHERE = 'That list was deleted on another device.';

// Every part, from storage. Parts above the lists are drawn only when what they
// show has changed (part). `lists: false` leaves the lists as they are: a
// change to the tests alone cannot change them.
// `restore: false` for a change the person just made (opening Rename, closing
// Delete): focus is put where those rules say straight after, and restoring
// the old control first would fall back to the lists heading and scroll.
function render({ lists = true, restore = true } = {}) {
  const view = read();
  if (needsCatalogue(view) && catalogue.status === 'idle') loadCatalogue();

  const resume = resumeOf(view.tests, EXAM);
  const review = reviewOf(view.state, Date.now());
  const plan = pickPlan({ resume, review, tests: view.attempts.length, marked: Object.keys(view.state.entries).length > 0 });
  part('pick', { plan, resume: resume && { id: resume.id, name: resume.name }, review }, drawPick);
  if (resume) drawResumeDetail(resume);
  const weak = weakOf(view);
  if (weak) part('weak', weak, drawWeak);

  const h = view.attempts.length ? headline(view.attempts, RULES) : null;
  part(
    'tests',
    { figures: h && figures(h), recent: h ? recentTests(view.tests, EXAM) : [], primary: plan.primary },
    drawTests
  );

  if (lists) {
    const state = view.state;
    const before = restore ? captureFocus() : null;
    // A list another tab or a sync removed cannot still be open here. Say so:
    // the editor or the question the person was in has gone from under them.
    if ((ui.edit && !state.lists[ui.edit.id]) || (ui.confirm && !state.lists[ui.confirm])) {
      ui.edit = ui.edit && state.lists[ui.edit.id] ? ui.edit : null;
      ui.confirm = ui.confirm && state.lists[ui.confirm] ? ui.confirm : null;
      say(listsNote, GONE_ELSEWHERE);
    }
    drawLists(summarise(state, {}).lists);
    restoreFocus(before);
  }

  part('coverage', coverageValue(view), drawCoverage);
  reveal();
  settle(view);
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
  render({ restore: false });
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
  render({ restore: false });
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
    release('sync'); // no account, so no first sync to wait for
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
      release('sync');
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

  // The first sync here is on its way: hold the first reveal until it ends.
  if (hinted && control?.dataset.auth !== 'out' && firstSyncHere(deviceOwner.read(), userId)) {
    holds.add('sync');
    document.addEventListener('sawaalbox:sync-done', () => release('sync'));
    setTimeout(() => release('sync'), FIRST_SYNC_HOLD_MS);
  }
  if (control) new MutationObserver(follow).observe(control, { attributes: true, attributeFilter: ['data-auth'] });
}

// Following "My lists" while already on this page: the address changes only by
// its hash, so nothing loads (hashchange), or, when it was already #lists,
// nothing changes at all (the click).
window.addEventListener('hashchange', () => landOnLists(true));
document.addEventListener('click', (event) => {
  const anchor = event.target.closest?.('a[href]');
  if (anchor && anchor.pathname === location.pathname && anchor.hash === '#lists') setTimeout(() => landOnLists(true));
});

// A sync that lands brings the account's marks, lists and test attempts. Other
// tabs (a test submitted in one) and a restored page change storage too.
//
// A change to the attempts alone leaves the lists as they are, and the other
// parts are drawn again only where their numbers changed: a test running in
// another tab saves its clock every 5 s, and that rewrites the Resume card's
// "time left" and nothing else.
document.addEventListener('sawaalbox:synced', () => render());
window.addEventListener('storage', (event) => {
  if (event.key === TESTS_KEY) render({ lists: false });
  else if (event.key === STORAGE_KEY || event.key === null) render();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) render();
});
// A catalogue that failed because the connection was down is asked for again
// when it comes back.
window.addEventListener('online', () => {
  if (catalogue.status !== 'failed') return;
  catalogue.status = 'idle';
  render();
});

render();
fontsReady().then(() => release('fonts'));
