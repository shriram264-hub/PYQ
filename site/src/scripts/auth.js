import { SUPABASE_URL, SUPABASE_KEY, sessionHint, storageKeyFor } from '../lib/accounts/config.js';

let clientPromise;

/** supabase-js is fetched only here, on demand: never for signed-out visitors. */
export function getClient() {
  clientPromise ??= import('@supabase/supabase-js')
    .then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    )
    .catch((e) => {
      // A transient chunk failure must not break Sign in until the next reload.
      clientPromise = undefined;
      throw e;
    });
  return clientPromise;
}

/** True when a session is stored, or we are returning from Google with a code (sessionHint). */
export function mayHaveSession() {
  try {
    return sessionHint(localStorage, location.search, storageKeyFor(SUPABASE_URL));
  } catch {
    return false;
  }
}

/**
 * The name shown for a signed-in student: the Google full name, else the email,
 * else nothing. A name of spaces counts as none, and a name or email that is
 * not text is ignored: it comes from the identity provider's metadata, which
 * is not ours to trust to be a string.
 */
export function displayNameOf(user) {
  const name = user?.user_metadata?.full_name;
  const email = user?.email;
  return (typeof name === 'string' && name.trim()) || (typeof email === 'string' && email.trim()) || '';
}

/**
 * The letter on the account button: the first character of the name, else of
 * the email, upper-cased. A name of spaces counts as none. The first code
 * point, not the first UTF-16 unit, so a character outside the basic plane is
 * shown whole; and a letter whose capital is longer (ß) keeps its own form.
 */
export function initialOf(user) {
  const from = displayNameOf(user) || '?';
  const first = String.fromCodePoint(from.codePointAt(0));
  const upper = first.toUpperCase();
  return [...upper].length === 1 ? upper : first;
}

// What Supabase and Google append to the address when they send the reader
// back: in the query for the PKCE flow, and in the hash for some errors.
const RETURN_PARAMS = ['code', 'error', 'error_code', 'error_description'];

const hashParams = (url) => new URLSearchParams(url.hash.slice(1));

/** Whether the address carries anything sign-in sent back, in the query or the hash. */
export function hasReturnParams(href) {
  const url = new URL(href);
  const hash = hashParams(url);
  return RETURN_PARAMS.some((name) => url.searchParams.has(name) || hash.has(name));
}

/**
 * The address without the sign-in return parameters, from the query and the
 * hash. Everything else stays; a hash that holds none of them (an anchor) is
 * not touched.
 */
export function withoutReturnParams(href) {
  const url = new URL(href);
  for (const name of RETURN_PARAMS) url.searchParams.delete(name);
  const hash = hashParams(url);
  if (RETURN_PARAMS.some((name) => hash.has(name))) {
    for (const name of RETURN_PARAMS) hash.delete(name);
    url.hash = hash.toString();
  }
  return url;
}

/**
 * Drops only the sign-in return parameters from the address bar. Everything
 * else the page keeps in its URL (a search query, a page number, the hash) and
 * history.state stays, so the reader lands exactly where they were.
 */
export function cleanReturnParams() {
  if (!hasReturnParams(location.href)) return;
  history.replaceState(history.state, '', withoutReturnParams(location.href));
}

export async function signIn() {
  const client = await getClient();
  // Come back to this exact page, query string included (a search keeps its
  // results). The hash is dropped: Supabase may append its own fragment.
  const back = withoutReturnParams(location.href);
  back.hash = '';
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: back.toString() },
  });
  if (error) throw error;
}

// How long sign-out waits for the last sync. Long enough for a queued change
// to reach the account on a working connection; short enough that a hung one
// never makes Sign out feel broken.
export const FINAL_SYNC_MS = 3000;

/**
 * Gives a running sync (sync.js) one last run, so changes still queued on this
 * device reach the account they were made under. Otherwise they would stay
 * here unsynced, and go to whichever account signs in next on this browser.
 * Waits at most `ms`, and never throws: sign-out must go ahead regardless.
 * With no sync on the page nothing answers, and it returns at once.
 */
export async function finishSyncing(ms = FINAL_SYNC_MS) {
  const runs = [];
  document.dispatchEvent(new CustomEvent('sawaalbox:signing-out', { detail: { waitUntil: (p) => runs.push(p) } }));
  if (!runs.length) return;
  let timer;
  await Promise.race([Promise.allSettled(runs), new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}

/**
 * Signs this device out, after one last sync (finishSyncing). Never leaves the
 * device signed in: if Supabase cannot confirm the sign-out (offline, server
 * error), the stored session is removed here, because on a shared computer a
 * silent failure is a privacy problem.
 */
export async function signOut() {
  await finishSyncing();
  let confirmed = false;
  try {
    const client = await getClient();
    const { error } = await client.auth.signOut({ scope: 'local' });
    confirmed = !error;
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    try {
      localStorage.removeItem(storageKeyFor(SUPABASE_URL));
    } catch {
      /* storage is blocked, so there is no stored session to remove */
    }
    // Otherwise the client's refresh timer could write the session back later.
    clientPromise?.then((client) => client.auth.stopAutoRefresh()).catch(() => {});
  }
}

export async function currentUser() {
  if (!mayHaveSession()) return null;
  const client = await getClient();
  const { data } = await client.auth.getSession();
  return data.session?.user ?? null;
}
