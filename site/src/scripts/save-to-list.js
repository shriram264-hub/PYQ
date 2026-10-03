import { STORAGE_KEY, loadState, saveState } from '../lib/accounts/progress-store.js';
import { createList, newListId, toggleKey } from '../lib/accounts/lists.js';

// The panel behind a question's "Save to list" button: a checkbox per list and
// a form for a new one. It writes to storage and announces the change with
// `sawaalbox:list`; sync.js, once signed in, hears that and sends it. This
// module is imported by marks.js, which builds the button.

const NOT_SAVED = 'Your browser would not save that. Check that it lets this site store data.';

const buttonOf = new WeakMap(); // panel -> the button that opens it
const keyOf = (el) => el.closest('.qblock[data-qkey]').dataset.qkey;
const panelOf = (button) => document.getElementById(button.getAttribute('aria-controls'));

function announce(listId, key, added) {
  document.dispatchEvent(new CustomEvent('sawaalbox:list', { detail: { listId, key, added } }));
}

// Built the first time its button is pressed, so a page of 25 questions does
// not carry 25 forms nobody opened. The form is built once and never redrawn:
// a half-typed name has to survive a sync repainting the rows above it.
function buildPanel(button) {
  const panel = document.createElement('div');
  panel.className = 'qlists';
  panel.id = button.getAttribute('aria-controls');
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Your revision lists');

  const rows = document.createElement('div');
  rows.className = 'qlists-rows';

  const form = document.createElement('form');
  form.className = 'qlists-new';
  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = `${panel.id}-name`;
  label.textContent = 'New list';
  const input = document.createElement('input');
  input.id = `${panel.id}-name`;
  input.type = 'text';
  input.maxLength = 80;
  input.autocomplete = 'off';
  input.placeholder = 'e.g. Polity revision';
  const add = document.createElement('button');
  add.type = 'submit';
  add.className = 'qlists-add';
  add.textContent = 'Add';
  form.append(label, input, add);

  const note = document.createElement('p');
  note.className = 'qlists-note';
  note.setAttribute('role', 'status');

  panel.append(rows, form, note);
  buttonOf.set(panel, button);
  return panel;
}

function rowFor(listId, list) {
  const row = document.createElement('label');
  row.className = 'qlists-row';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.list = listId;
  const name = document.createElement('span');
  name.textContent = list.name; // textContent: a list name is the student's text, never markup
  row.append(box, name);
  return row;
}

// Bring a panel's rows in line with storage. When the set of lists is the same
// only the ticks change, so a focused checkbox keeps its focus; otherwise the
// rows are rebuilt and focus is put back.
function refresh(panel) {
  const key = keyOf(panel);
  const rows = panel.querySelector('.qlists-rows');
  const { lists } = loadState();
  const ids = Object.keys(lists);
  const signature = JSON.stringify(ids.map((id) => [id, lists[id].name]));
  if (rows.dataset.signature !== signature) {
    const focused = rows.contains(document.activeElement) ? document.activeElement.dataset.list : null;
    rows.replaceChildren();
    if (!ids.length) {
      const empty = document.createElement('p');
      empty.className = 'qlists-empty';
      empty.textContent = 'No lists yet. Name one below.';
      rows.append(empty);
    }
    for (const id of ids) rows.append(rowFor(id, lists[id]));
    rows.dataset.signature = signature;
    if (focused) [...rows.querySelectorAll('input')].find((i) => i.dataset.list === focused)?.focus();
  }
  for (const box of rows.querySelectorAll('input[data-list]')) {
    box.checked = Boolean(lists[box.dataset.list]?.keys.includes(key));
  }
}

function refreshOpen() {
  for (const panel of document.querySelectorAll('.qlists:not([hidden])')) refresh(panel);
}

function setOpen(button, panel, open) {
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open) {
    panel.querySelector('.qlists-note').textContent = '';
    refresh(panel);
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.qmark-save');
  if (!button) return;
  let panel = panelOf(button);
  if (!panel) {
    panel = buildPanel(button);
    button.closest('.qmarks').after(panel);
  }
  setOpen(button, panel, panel.hidden);
});

// A tick is a request for a state, not a flip: if storage already says so (a
// sync or another tab got there first) there is nothing to write, and the
// panel is just redrawn from the truth.
document.addEventListener('change', (event) => {
  const box = event.target.closest?.('.qlists input[data-list]');
  if (!box) return;
  const panel = box.closest('.qlists');
  const before = loadState();
  const { state, added } = toggleKey(before, box.dataset.list, keyOf(box));
  if (state === before || added !== box.checked) return refreshOpen();
  if (!saveState(state)) {
    box.checked = !box.checked;
    panel.querySelector('.qlists-note').textContent = NOT_SAVED;
    return;
  }
  panel.querySelector('.qlists-note').textContent = '';
  announce(box.dataset.list, keyOf(box), added);
  refreshOpen(); // the same question can be open in a second panel
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest?.('.qlists-new');
  if (!form) return;
  event.preventDefault();
  const panel = form.closest('.qlists');
  const input = form.querySelector('input');
  const key = keyOf(form);
  try {
    const id = newListId();
    // The new list starts with this question in it: that is why they made it.
    const { state } = toggleKey(createList(loadState(), input.value, id), id, key);
    if (!saveState(state)) throw new Error(NOT_SAVED);
    input.value = '';
    panel.querySelector('.qlists-note').textContent = '';
    announce(id, key, true);
    refreshOpen();
  } catch (e) {
    input.setCustomValidity(e.message);
    form.reportValidity();
  }
});

// A custom validity message blocks the next submit until it is cleared.
document.addEventListener('input', (event) => {
  if (event.target.matches?.('.qlists-new input')) event.target.setCustomValidity('');
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const button = event.target.closest?.('.qmark-save');
  const panel = event.target.closest?.('.qlists') ?? (button && panelOf(button));
  if (!panel || panel.hidden) return;
  const opener = buttonOf.get(panel);
  setOpen(opener, panel, false);
  opener.focus();
});

// Lists change under an open panel when a sync lands, in another tab, or when
// the page returns from the back/forward cache.
document.addEventListener('sawaalbox:synced', refreshOpen);
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) refreshOpen();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) refreshOpen();
});
