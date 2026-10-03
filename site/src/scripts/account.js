import { authEnabled } from '../lib/accounts/config.js';
import { cleanReturnParams, getClient, hasReturnParams, initialOf, mayHaveSession, signIn, signOut } from './auth.js';

const root = document.querySelector('[data-account]');

const FAILED_SIGN_IN = 'Sign-in did not finish. Your progress on this device is safe; try again any time.';

let noteTimer;
function note(text) {
  const el = root.querySelector('[data-account-note]');
  // On phones the note is fixed to the viewport (see the stylesheet) so it can
  // never run off the screen. It starts just under the nav row(s) that hold the
  // control (so it never covers the theme toggle when the nav wraps), or at the
  // top edge when the header has scrolled away.
  const anchor = root.closest('nav') ?? root;
  el.style.setProperty('--account-note-top', `${Math.max(anchor.getBoundingClientRect().bottom + 8, 8)}px`);
  el.textContent = text;
  el.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => (el.hidden = true), 8000);
}

function show(user) {
  root.querySelector('[data-account-signin]').hidden = Boolean(user);
  root.querySelector('[data-account-user]').hidden = !user;
  // The settled answer, kept on the control for anything that starts after this
  // has run or must not miss it: /account reads it once and watches it. An
  // event alone would be lost when there is no session to look for, because
  // that path never waits, so it can finish before a later script has listened.
  // Every end of start() goes through here, a failed return and a failed chunk
  // included, so "signed out" is announced whatever the reason.
  root.dataset.auth = user ? 'in' : 'out';
  if (user) root.querySelector('[data-account-initial]').textContent = initialOf(user);
}

/**
 * Every way this tab learns its session has ended comes here: its own Sign out,
 * or supabase-js reporting SIGNED_OUT (another tab signed out, or the session
 * could not be refreshed). Only the first call while signed in does anything,
 * so the tab that pressed Sign out, which hears both, announces it once.
 */
function endSession() {
  if (root.dataset.auth !== 'in') return;
  const signin = root.querySelector('[data-account-signin]');
  // Hiding the control while focus is in it would drop focus to the page.
  const hadFocus = root.contains(document.activeElement);
  root.querySelector('[data-account-menu]').hidden = true;
  root.querySelector('[data-account-toggle]').setAttribute('aria-expanded', 'false');
  show(null);
  if (hadFocus) signin.focus();
  document.dispatchEvent(new CustomEvent('sawaalbox:signed-out'));
}

async function start() {
  // Coming back from Google: with a code we should end up signed in, and with
  // an error (in the query, or in the hash) the sign-in was refused. Either
  // way, no user means we say so.
  const returning = hasReturnParams(location.href);
  let user = null;
  let client = null;
  try {
    if (mayHaveSession()) {
      client = await getClient();
      // supabase-js tells every tab when the session ends in any of them
      // (it broadcasts SIGNED_OUT to the others), so a tab left open does not
      // go on showing, and syncing, an account that has signed out.
      client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') endSession();
      });
      const { data } = await client.auth.getSession();
      user = data.session?.user ?? null;
    }
  } catch (e) {
    // A failed code exchange or a chunk that would not load: fall through to
    // the signed-out state rather than leave the control blank.
    console.warn('SawaalBox: sign-in check failed', e);
  }
  show(user);
  if (returning) {
    if (!user) note(FAILED_SIGN_IN);
    cleanReturnParams();
  }
  if (user) document.dispatchEvent(new CustomEvent('sawaalbox:signed-in', { detail: { client, user } }));
}

if (authEnabled && root) {
  const signin = root.querySelector('[data-account-signin]');
  const toggle = root.querySelector('[data-account-toggle]');
  const menu = root.querySelector('[data-account-menu]');

  const close = () => {
    // Hiding the menu while focus is inside it would drop focus to the page.
    const hadFocus = menu.contains(document.activeElement);
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (hadFocus) toggle.focus();
  };

  signin.addEventListener('click', () =>
    signIn().catch(() => note('Could not reach the sign-in service. Your progress on this device is safe.'))
  );
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.addEventListener('click', (e) => !root.contains(e.target) && close());
  // Tabbing past the last item leaves the menu; it should not stay open behind.
  root.addEventListener('focusout', (e) => {
    if (!menu.hidden && !root.contains(e.relatedTarget)) close();
  });
  // signOut gives the sync a last run of up to a few seconds first. Meanwhile
  // the button says so, and is busy and disabled: a second press is the same
  // sign-out, not another one. Disabled through aria-disabled and this flag,
  // not the disabled attribute: disabling the focused button would drop focus
  // to the page, and the focusout handler above would close the menu with
  // "Signing out…" in it.
  const signout = root.querySelector('[data-account-signout]');
  let signingOut = false;
  signout.addEventListener('click', async () => {
    if (signingOut) return;
    signingOut = true;
    const label = signout.textContent;
    signout.textContent = 'Signing out…';
    signout.setAttribute('aria-busy', 'true');
    signout.setAttribute('aria-disabled', 'true');
    try {
      await signOut();
    } finally {
      signingOut = false;
      signout.textContent = label;
      signout.removeAttribute('aria-busy');
      signout.removeAttribute('aria-disabled');
    }
    // supabase-js has usually announced SIGNED_OUT by now; when it could not
    // (its chunk failed to load), this ends the session here. Either way, once.
    endSession();
  });

  start().catch((e) => {
    console.warn('SawaalBox: sign-in check failed', e);
    show(null);
  });
}
