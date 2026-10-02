import { SUPABASE_URL, SUPABASE_KEY, storageKeyFor } from '../lib/accounts/config.js';

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

/** True when a session is stored, or we are returning from Google with a code. */
export function mayHaveSession() {
  try {
    const key = storageKeyFor(SUPABASE_URL);
    if (localStorage.getItem(key)) return true;
    return new URLSearchParams(location.search).has('code') && Boolean(localStorage.getItem(`${key}-code-verifier`));
  } catch {
    return false;
  }
}

// What Supabase and Google append to the address when they send the reader back.
const RETURN_PARAMS = ['code', 'error', 'error_code', 'error_description'];

function urlWithoutReturnParams() {
  const url = new URL(location.href);
  for (const name of RETURN_PARAMS) url.searchParams.delete(name);
  return url;
}

/**
 * Drops only the sign-in return parameters from the address bar. Everything
 * else the page keeps in its URL (a search query, a page number, the hash) and
 * history.state stays, so the reader lands exactly where they were.
 */
export function cleanReturnParams() {
  const params = new URLSearchParams(location.search);
  if (!RETURN_PARAMS.some((name) => params.has(name))) return;
  history.replaceState(history.state, '', urlWithoutReturnParams());
}

export async function signIn() {
  const client = await getClient();
  // Come back to this exact page, query string included (a search keeps its
  // results). The hash is dropped: Supabase may append its own fragment.
  const back = urlWithoutReturnParams();
  back.hash = '';
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: back.toString() },
  });
  if (error) throw error;
}

/**
 * Signs this device out. Never leaves the device signed in: if Supabase cannot
 * confirm the sign-out (offline, server error), the stored session is removed
 * here, because on a shared computer a silent failure is a privacy problem.
 */
export async function signOut() {
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
