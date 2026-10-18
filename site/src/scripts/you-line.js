import { examRules } from '../lib/exam-rules.js';
import { canSeeAnalytics } from '../lib/tests/access.js';
import { parseCatalogue } from '../lib/tests/catalogue.js';
import { breakdown, statsLine, submittedFor } from '../lib/tests/analytics.js';
import { TESTS_KEY, loadTests } from '../lib/tests/store.js';
import { STORAGE_KEY, loadState } from '../lib/accounts/progress-store.js';

// The line about this student on a subject or topic page (YouLine.astro; spec
// 2026-10-18-analytics-design.md, section 2): their accuracy and coverage in
// this subject or topic, from this device's submitted tests and marks and the
// exam's catalogue, or nothing.
//
// YouLine.astro loads this only for a line whose room it held before first
// paint, and this draws into no other: a line that was not held stays empty,
// because filling it would push down a page already on screen. Within the held
// room the text may come, change or go; the room itself never changes.
//
// Nothing here names an exam: it is the line's data-exam, the catalogue's
// address is built from it, and the marking comes from lib/exam-rules.js. The
// text goes in as text nodes (see show), never parsed.

const FILE_TIMEOUT_MS = 15000;

const line = document.querySelector('[data-you-line][data-hold]');
const exam = line?.dataset.exam;
const rules = exam ? examRules(exam) : null;

if (line && rules) {
  const { subject, topic } = line.dataset;
  // A question key names its exam first (questionKey in lib/accounts/qkey.js).
  const ofExam = (key) => key.startsWith(`${exam}-`);

  // Analytics is free during the beta; the line shows only once the one access
  // check says yes, and a check that fails says no.
  const allowed = canSeeAnalytics(exam).then(
    (ok) => ok === true,
    () => false
  );

  // One request per page view, never retried: a held line whose catalogue does
  // not come (offline, too slow, not a catalogue) stays empty. A controller and
  // a timer rather than AbortSignal.timeout, which older Safari lacks.
  let catalogue = null;
  const loadCatalogue = () =>
    (catalogue ??= (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
      try {
        const response = await fetch(`/${exam}/catalogue.json`, { signal: controller.signal });
        return response.ok ? parseCatalogue(await response.json()) : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })());

  // This exam's submitted tests and the device's marks. Blocked or unreadable
  // storage reads as empty (loadTests, loadState).
  const read = () => {
    const attempts = submittedFor(loadTests(), exam);
    const marks = loadState().entries;
    return { attempts, marks, any: attempts.length > 0 || Object.keys(marks).some(ofExam) };
  };

  // breakdown() walks every attempt and the whole catalogue. Its inputs are the
  // submitted attempts, which do not change once submitted, and the marks, so it
  // is worked out again only when one of those has: a test running in another
  // tab saves its clock every 5 s, and that changes neither.
  let memo = { key: null, value: null };
  const breakdownOf = (view, parsed) => {
    const marks = Object.entries(view.marks)
      .filter(([key]) => ofExam(key))
      .map(([key, m]) => [key, m.status, m.updatedAt]);
    const key = JSON.stringify([view.attempts.map((a) => [a.id, a.submittedAt]), marks]);
    if (memo.key !== key) memo = { key, value: breakdown(view.attempts, view.marks, parsed, rules, exam) };
    return memo.value;
  };

  // Written only when it differs: the same text written again would still be a
  // change to the page, and the 5 s saves above would make one every 5 s.
  // The last part, "Covered 11 of 422", is kept whole (.you-line-last), so on a
  // phone the line breaks after its "·" rather than between "11" and "of 422".
  // Either way the line's text is statsLine's, as text nodes.
  const show = (text) => {
    if (line.textContent === text) return;
    const at = text.lastIndexOf(' · ');
    if (at < 0) {
      line.textContent = text;
      return;
    }
    const last = document.createElement('span');
    last.className = 'you-line-last';
    last.textContent = text.slice(at + 3);
    line.replaceChildren(text.slice(0, at + 3), last);
  };

  // Only the latest call draws: one still waiting for the catalogue when storage
  // changes again would otherwise draw what storage held before.
  let latest = 0;
  const fill = async () => {
    const mine = ++latest;
    const view = read();
    // Nothing of this exam's on the device (an unfinished test, another exam's
    // marks): nothing to say, and nothing fetched.
    if (!view.any) return show('');
    const parsed = (await allowed) ? await loadCatalogue() : null;
    if (mine !== latest || !parsed) return;
    const b = breakdownOf(view, parsed);
    const stats = topic === undefined ? b.bySubject.get(subject) : b.byTopic.get(`${subject}\u0000${topic}`);
    show(statsLine(stats) ?? '');
  };

  fill();

  // Storage changed under the page: a sync landed, another tab wrote, a mark
  // was made on this page (marks.js says so with sawaalbox:mark, as a write in
  // this tab raises no storage event here), or the page came back from the
  // back/forward cache. The line is redrawn only if its text changed.
  document.addEventListener('sawaalbox:synced', fill);
  document.addEventListener('sawaalbox:mark', fill);
  window.addEventListener('storage', (event) => {
    if (event.key === TESTS_KEY || event.key === STORAGE_KEY || event.key === null) fill();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) fill();
  });
}
