import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sessionHint, storageKeyFor } from '../src/lib/accounts/config.js';

test('derives supabase-js session storage key from the project URL', () => {
  assert.equal(storageKeyFor('https://fcmwzpokqufvkojcqaxo.supabase.co'), 'sb-fcmwzpokqufvkojcqaxo-auth-token');
});

// The installed auth-js writes the verifier keys in these tests, so a change
// to their shape in a supabase-js update fails here rather than on the live
// site, where it would silently stop sign-in from completing.
const require = createRequire(import.meta.url);
const pkce = require('@supabase/auth-js/dist/main/lib/helpers.js');
const { PKCE_FLOW_ID_PARAM } = require('@supabase/auth-js/dist/main/lib/constants.js');

const KEY = storageKeyFor('https://abcd.supabase.co');
const FLOW = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const LEGACY = `${KEY}-code-verifier`;
const INDEX = `${KEY}-flows-code-verifier`;

function memory(entries = {}) {
  const m = new Map(Object.entries(entries));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()],
  };
}

test('a stored session is a reason to load supabase-js', () => {
  assert.equal(sessionHint(memory({ [KEY]: '{"access_token":"x"}' }), '', KEY), true);
  assert.equal(sessionHint(memory(), '', KEY), false);
});

test('a return from Google is recognised by every verifier key supabase-js 2.117 writes', async () => {
  const written = memory();
  await pkce.storePKCEVerifier(written, KEY, FLOW, 'verifier');
  assert.deepEqual(written.keys().sort(), [LEGACY, pkce.pkceVerifierSlotKey(KEY, FLOW), INDEX].sort(), 'the keys this test knows');
  assert.equal(sessionHint(written, '?code=abc', KEY), true);

  // Each key on its own, as a later version that drops the legacy dual-write would leave things.
  const slot = pkce.pkceVerifierSlotKey(KEY, FLOW);
  assert.equal(sessionHint(memory({ [LEGACY]: '"v"' }), '?code=abc', KEY), true, 'the legacy fixed key');
  assert.equal(sessionHint(memory({ [slot]: '"v"' }), `?code=abc&${PKCE_FLOW_ID_PARAM}=${FLOW}`, KEY), true, 'the per-flow slot the URL names');
  assert.equal(sessionHint(memory({ [INDEX]: JSON.stringify([FLOW]) }), '?code=abc', KEY), true, 'a pending flow in the index');
});

test('without a code, or without a verifier, it is not a return from sign-in', async () => {
  const written = memory();
  await pkce.storePKCEVerifier(written, KEY, FLOW, 'verifier');
  assert.equal(sessionHint(written, '?q=polity', KEY), false, 'a verifier but no code');
  assert.equal(sessionHint(memory(), '?code=abc', KEY), false, 'a code but no verifier');
  const slot = pkce.pkceVerifierSlotKey(KEY, FLOW);
  assert.equal(sessionHint(memory({ [slot]: '"v"' }), `?code=abc&${PKCE_FLOW_ID_PARAM}=other-flow-id`, KEY), false, 'another flow');
  assert.equal(sessionHint(memory({ [`${KEY}-flow-../x-code-verifier`]: '"v"' }), `?code=abc&${PKCE_FLOW_ID_PARAM}=../x`, KEY), false, 'a flow id of the wrong shape is not looked up');
  for (const index of ['[]', '{nope', '"a"', 'null']) {
    assert.equal(sessionHint(memory({ [INDEX]: index }), '?code=abc', KEY), false, `index ${index}`);
  }
});
