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
