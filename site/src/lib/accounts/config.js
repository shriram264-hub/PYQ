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
