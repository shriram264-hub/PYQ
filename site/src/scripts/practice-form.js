import { MINUTE, newAttempt } from '../lib/tests/attempt.js';
import { loadTests, putAttempt, saveTests } from '../lib/tests/store.js';
import { parseCatalogue } from '../lib/tests/catalogue.js';
import { defaultMinutes, drawSet, newSeed, setPool } from '../lib/tests/build.js';
import { poolMessage, preselection, readSpec } from '../lib/tests/form.js';
import { canStartTest } from '../lib/tests/access.js';
import { STORAGE_KEY, loadState } from '../lib/accounts/progress-store.js';
// A uuid v4 maker; attempts need the same kind of id lists do.
import { newListId as newId } from '../lib/accounts/lists.js';

// The practice-set form on /upsc/test (spec, "Build a practice set"). The
// form is the page's markup; this enables it, counts what matches as the
// student chooses, and starts the set. The catalogue (/upsc/catalogue.json,
// about 20.9 KB gzipped) is fetched only once the form is used.

const CATALOGUE_PATH = '/upsc/catalogue.json';
const FILE_TIMEOUT_MS = 15000;
const NOT_SAVED = 'Your browser would not save the test. Check that it lets this site store data.';

const form = document.querySelector('[data-practice]');
const fields = form.querySelector('[data-practice-fields]');
const poolEl = form.querySelector('[data-pool]');
const retryRow = form.querySelector('[data-pool-retry]');
const startBtn = form.querySelector('[data-practice-start]');
const minutesInput = form.elements.minutes;

let catalogue = null;
let loading = null; // the fetch in flight, if any
let failed = false;
let minutesTouched = false;
let starting = false;
let leaving = false; // a set has started and the page is on its way to it

const subjectBoxes = () => [...form.querySelectorAll('input[name=subject]')];
const topicBoxes = () => [...form.querySelectorAll('input[name=topic]')];

function values() {
  const data = new FormData(form);
  return {
    subjects: data.getAll('subject'),
    topics: data.getAll('topic'),
    fromYear: data.get('fromYear'),
    toYear: data.get('toYear'),
    count: data.get('count'),
    minutes: data.get('minutes'),
    skipDone: data.has('skipDone'),
    onlyReview: data.has('onlyReview'),
  };
}

function ensureCatalogue() {
  if (catalogue) return Promise.resolve(true);
  if (loading) return loading;
  failed = false;
  retryRow.hidden = true;
  poolEl.textContent = 'Counting the questions…';
  loading = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
    try {
      const response = await fetch(CATALOGUE_PATH, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      catalogue = parseCatalogue(await response.json());
      if (!catalogue) throw new Error('not a catalogue');
      update();
      return true;
    } catch {
      failed = true;
      poolEl.textContent = "The question list didn't load. Check your connection, then try again.";
      retryRow.hidden = false;
      return false;
    } finally {
      clearTimeout(timer);
      loading = null;
    }
  })();
  return loading;
}

function update() {
  if (!catalogue) return;
  const spec = readSpec(values(), 0);
  const pool = setPool(spec, catalogue, loadState().entries);
  // Rewritten only when it changes: it is a live region, and a count that did
  // not change is not news.
  const message = poolMessage(pool.length, spec.count);
  if (poolEl.textContent !== message) poolEl.textContent = message;
  startBtn.disabled = pool.length === 0;
  if (!minutesTouched) minutesInput.value = String(defaultMinutes(Math.min(spec.count, pool.length || spec.count)));
}

form.addEventListener('change', (event) => {
  const box = event.target;
  if (box.name === 'topic' && box.checked) {
    const subject = subjectBoxes().find((s) => s.dataset.slug === box.dataset.subject);
    if (subject) subject.checked = true;
  }
  if (box.name === 'subject' && !box.checked) {
    for (const t of topicBoxes()) if (t.dataset.subject === box.dataset.slug) t.checked = false;
  }
  update();
});
minutesInput.addEventListener('input', () => {
  minutesTouched = true;
});

// Fetched the first time the form is used, not with the page.
const wake = () => ensureCatalogue();
form.addEventListener('focusin', wake, { once: true });
form.addEventListener('pointerdown', wake, { once: true });
retryRow.querySelector('button').addEventListener('click', () => ensureCatalogue());
window.addEventListener('online', () => {
  if (failed) ensureCatalogue();
});

// A press while a start is under way does nothing (`starting`), so Start is
// not disabled meanwhile, which would show it as unavailable for the moment a
// start takes. A start that does not go ahead says why in the pool line, and
// nothing recounts over that before it is read.
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (starting) return;
  starting = true;
  try {
    if (!(await ensureCatalogue())) return;
    const spec = readSpec(values(), newSeed());
    const pool = setPool(spec, catalogue, loadState().entries);
    if (!pool.length) {
      update();
      return;
    }
    if (!(await canStartTest('upsc'))) {
      poolEl.textContent = "Tests aren't open to this account.";
      return;
    }
    const attempt = newAttempt({
      id: newId(),
      kind: 'custom',
      spec,
      keys: drawSet(pool, spec.count, spec.seed),
      limitMs: spec.minutes * MINUTE,
      now: new Date().toISOString(),
    });
    if (!saveTests(putAttempt(loadTests(), attempt))) {
      poolEl.textContent = NOT_SAVED;
      return;
    }
    document.dispatchEvent(new CustomEvent('sawaalbox:test'));
    // Still `starting` until the page has gone: a second press in the moment
    // before it does would start a second set.
    leaving = true;
    location.assign(`/upsc/test/take?attempt=${encodeURIComponent(attempt.id)}`);
  } finally {
    if (!leaving) starting = false;
  }
});

// Back from the set just started: the page returns from the back/forward cache
// as it was left, mid-start. Free the form, and count again: marks may have
// changed meanwhile.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  leaving = false;
  starting = false;
  update();
});

// Marks changed under the form (another tab, or a sync that brought the
// account's): the switches count from them, so count again.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) update();
});
document.addEventListener('sawaalbox:synced', () => update());

// A Practise link: tick what it names, and count at once.
const pre = preselection(location.search);
if (pre.subject) {
  const subject = subjectBoxes().find((s) => s.dataset.slug === pre.subject);
  if (subject) {
    subject.checked = true;
    const topic = pre.topic && topicBoxes().find((t) => t.dataset.subject === pre.subject && t.dataset.slug === pre.topic);
    if (topic) {
      topic.checked = true;
      topic.closest('details').open = true;
    }
    ensureCatalogue();
  }
}

fields.disabled = false;
