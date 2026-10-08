// Under plain Node (the test runner) `import.meta.env` is undefined, so the
// module has to import cleanly without it. Vite inlines the PUBLIC_ values at
// build time in the browser bundle.
const env = import.meta.env ?? {};

export const SUPABASE_URL = env.PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const AUTH_PROVIDERS = String(env.PUBLIC_AUTH_PROVIDERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Sign in stays hidden until a provider is configured end to end.
export const authEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY && AUTH_PROVIDERS.includes('google'));

/** The localStorage key supabase-js v2 uses for a session on this project. */
export function storageKeyFor(url) {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

// The flow id supabase-js puts in a slot key (validatePKCEFlowId in
// @supabase/auth-js): checked before it is used to build one, since it comes
// from the address.
const FLOW_ID = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * The id of the user in the session supabase-js stored, or null: nothing stored,
 * unreadable, or not text. Read straight from storage so a page can know who is
 * probably signed in before supabase-js has loaded (and without loading it).
 * It is a hint, not proof: the session may have expired.
 */
export function storedUserId(storage, storageKey) {
  try {
    const id = JSON.parse(storage.getItem(storageKey))?.user?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * Whether the first sync of this account on this browser is yet to come: no
 * account has held its data here (`owner` null, see deviceOwner in pull.js),
 * or another one did. Such a sync brings in everything, so a page that shows
 * the account's data waits for it. An owner that is this user, or a user who
 * cannot be told apart from it, is a returning visit: the data is already here.
 */
export function firstSyncHere(owner, userId) {
  return owner === null || (userId !== null && owner !== userId);
}

/**
 * Whether this browser may have a session, so supabase-js is worth loading:
 * one is stored, or the address is a return from Google (`?code=`) that this
 * browser started. The second follows supabase-js's own test (_isPKCECallback
 * in @supabase/auth-js 2.117): a verifier under the fixed legacy key, or in the
 * per-flow slot named by the `sb_flow_id` parameter. A pending flow in its
 * index counts too, so a later version that stops writing the legacy key, and
 * a return without the flow id, still load the client. `storage` is
 * localStorage, or anything with its getItem.
 */
export function sessionHint(storage, search, storageKey) {
  if (storage.getItem(storageKey)) return true;
  const params = new URLSearchParams(search);
  if (!params.has('code')) return false;
  if (storage.getItem(`${storageKey}-code-verifier`)) return true;
  const flowId = params.get('sb_flow_id');
  if (flowId && FLOW_ID.test(flowId) && storage.getItem(`${storageKey}-flow-${flowId}-code-verifier`)) return true;
  try {
    const flows = JSON.parse(storage.getItem(`${storageKey}-flows-code-verifier`));
    return Array.isArray(flows) && flows.length > 0;
  } catch {
    return false;
  }
}
