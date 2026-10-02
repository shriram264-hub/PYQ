import { authEnabled } from '../lib/accounts/config.js';
import { getClient, mayHaveSession, signIn, signOut } from './auth.js';

const root = document.querySelector('[data-account]');

function note(text) {
  const el = root.querySelector('[data-account-note]');
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 8000);
}

function show(user) {
  root.querySelector('[data-account-signin]').hidden = Boolean(user);
  root.querySelector('[data-account-user]').hidden = !user;
  if (user) {
    const name = user.user_metadata?.full_name || user.email || '?';
    root.querySelector('[data-account-initial]').textContent = name.trim()[0].toUpperCase();
  }
}

async function start() {
  const params = new URLSearchParams(location.search);
  if (params.has('error_description')) {
    note('Sign-in did not finish. Your progress on this device is safe; try again any time.');
    history.replaceState(null, '', location.pathname);
  }
  if (!mayHaveSession()) return show(null);
  const client = await getClient();
  const { data } = await client.auth.getSession();
  const user = data.session?.user ?? null;
  show(user);
  if (params.has('code')) history.replaceState(null, '', location.pathname);
  if (user) document.dispatchEvent(new CustomEvent('sawaalbox:signed-in', { detail: { client, user } }));
}

if (authEnabled && root) {
  const toggle = root.querySelector('[data-account-toggle]');
  const menu = root.querySelector('[data-account-menu]');
  const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };

  root.querySelector('[data-account-signin]').addEventListener('click', () =>
    signIn().catch(() => note('Could not reach the sign-in service. Your progress on this device is safe.'))
  );
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.addEventListener('click', (e) => !root.contains(e.target) && close());
  root.querySelector('[data-account-signout]').addEventListener('click', async () => {
    await signOut();
    close();
    show(null);
  });

  start().catch((e) => console.warn('SawaalBox: sign-in check failed', e));
}
