import { STORAGE_KEY, loadState, saveState, setMark } from '../lib/accounts/progress-store.js';

const CONTROLS = [
  { status: 'done', label: 'Mark done' },
  { status: 'review', label: 'Needs review' },
];

function ensureControls(block) {
  const existing = block.querySelector(':scope > .qmarks');
  if (existing) return existing;
  const group = document.createElement('div');
  group.className = 'qmarks';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Your progress on this question');
  for (const c of CONTROLS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'qmark';
    b.dataset.status = c.status;
    b.textContent = c.label;
    b.setAttribute('aria-pressed', 'false');
    group.append(b);
  }
  // Between the options and the sealed answer: decide, then check.
  block.insertBefore(group, block.querySelector(':scope > .qanswer, :scope > .qanswer-none'));
  return group;
}

function blocksIn(root) {
  if (root.matches?.('.qblock[data-qkey]')) return [root];
  return root.querySelectorAll ? root.querySelectorAll('.qblock[data-qkey]') : [];
}

export function paintAll(root = document) {
  const { entries } = loadState();
  for (const block of blocksIn(root)) {
    const status = entries[block.dataset.qkey]?.status;
    for (const b of ensureControls(block).querySelectorAll('.qmark')) {
      b.setAttribute('aria-pressed', String(b.dataset.status === status));
    }
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.qmark');
  if (!button) return;
  const key = button.closest('.qblock[data-qkey]').dataset.qkey;
  const current = loadState();
  // Pressing the active mark clears it.
  const next = current.entries[key]?.status === button.dataset.status ? null : button.dataset.status;
  const { state, op } = setMark(current, key, next);
  saveState(state);
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
// A later sync repaints by dispatching this event rather than importing this
// module: marks.js registers a click handler as a side effect, so a second
// module instance would register it twice and every click would toggle twice.
document.addEventListener('sawaalbox:synced', () => paintAll());

paintAll();
