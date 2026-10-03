import { STORAGE_KEY, enqueue, loadState, saveState, setMark } from '../lib/accounts/progress-store.js';
// The "Save to list" panel. Imported here, not from the pages, so there is one
// module instance and its listeners register once (see the note on sync.js).
import './save-to-list.js';

const CONTROLS = [
  { status: 'done', label: 'Mark done' },
  { status: 'review', label: 'Needs review' },
];

// Set only when storage refused our last write (blocked, private mode, full).
// It holds what the person just did so this page still shows it; the next
// successful write clears it and storage is the source of truth again.
let pageState = null;
const current = () => pageState ?? loadState();

// Blocks arrive with an empty, server-rendered .qmarks slot so the page does
// not shift when this runs. Fill that slot; create it only if a block has none.
function ensureControls(block) {
  let group = block.querySelector(':scope > .qmarks');
  if (!group) {
    group = document.createElement('div');
    group.className = 'qmarks';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Your progress and lists for this question');
    // Between the options and the sealed answer: decide, then check.
    block.insertBefore(group, block.querySelector(':scope > .qanswer, :scope > .qanswer-none'));
  }
  if (!group.querySelector('.qmark')) {
    for (const c of CONTROLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'qmark';
      b.dataset.status = c.status;
      b.textContent = c.label;
      b.setAttribute('aria-pressed', 'false');
      group.append(b);
    }
    group.append(saveButton());
  }
  return group;
}

// Not a toggle, so no aria-pressed and no data-status: paintAll and the click
// handler below act only on `.qmark[data-status]`. save-to-list.js owns this
// button, and builds the panel it controls when it is first opened.
let panels = 0;
function saveButton() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'qmark qmark-save';
  b.textContent = 'Save to list';
  // An id per button, not per question: the same question can be on a page twice.
  b.setAttribute('aria-controls', `qlists-${++panels}`);
  b.setAttribute('aria-expanded', 'false');
  return b;
}

function blocksIn(root) {
  if (root.matches?.('.qblock[data-qkey]')) return [root];
  return root.querySelectorAll ? root.querySelectorAll('.qblock[data-qkey]') : [];
}

export function paintAll(root = document) {
  const { entries } = current();
  for (const block of blocksIn(root)) {
    const status = entries[block.dataset.qkey]?.status;
    for (const b of ensureControls(block).querySelectorAll('.qmark[data-status]')) {
      b.setAttribute('aria-pressed', String(b.dataset.status === status));
    }
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.qmark[data-status]');
  if (!button) return;
  const key = button.closest('.qblock[data-qkey]').dataset.qkey;
  // Act on what the person is looking at, not on what storage says now: another
  // tab or a restored page may have changed it since this page last painted.
  // Pressing the active mark clears it.
  const next = button.getAttribute('aria-pressed') === 'true' ? null : button.dataset.status;
  // The op joins the pending queue in the same write as the mark. sync.js only
  // listens for the event to start a run, so a mark made before sync.js loads,
  // or while signed out, is still queued and cannot lose to an older account copy.
  const { state, op } = setMark(current(), key, next);
  const updated = enqueue(state, op);
  pageState = saveState(updated) ? null : updated;
  paintAll(); // the same question can appear twice on one page
  document.dispatchEvent(new CustomEvent('sawaalbox:mark', { detail: op }));
});

// Search renders results after load; other tabs can change progress too.
new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) paintAll(n);
}).observe(document.body, { childList: true, subtree: true });
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) paintAll();
});
// A page restored from the back/forward cache keeps its old DOM and runs no
// scripts, so it can show marks that changed while it was away.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) paintAll();
});
// A later sync repaints by dispatching this event rather than importing this
// module: marks.js registers a click handler as a side effect, so a second
// module instance would register it twice and every click would toggle twice.
// A sync only fires this after it wrote to storage, which proves storage works
// again, so drop the in-page fallback rather than let it shadow what was saved.
document.addEventListener('sawaalbox:synced', () => {
  pageState = null;
  paintAll();
});

paintAll();
