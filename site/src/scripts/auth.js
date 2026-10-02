import { SUPABASE_URL, SUPABASE_KEY, storageKeyFor } from '../lib/accounts/config.js';

let clientPromise;

/** supabase-js is fetched only here, on demand: never for signed-out visitors. */
export function getClient() {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  );
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

export async function signIn() {
  const client = await getClient();
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}${location.pathname}` },
  });
  if (error) throw error;
}

export async function signOut() {
  const client = await getClient();
  await client.auth.signOut();
}

export async function currentUser() {
  if (!mayHaveSession()) return null;
  const client = await getClient();
  const { data } = await client.auth.getSession();
  return data.session?.user ?? null;
}
