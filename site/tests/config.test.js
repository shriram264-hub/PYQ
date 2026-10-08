import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { firstSyncHere, sessionHint, storageKeyFor, storedUserId } from '../src/lib/accounts/config.js';

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

// --- Who is signed in, before supabase-js is loaded to say so. ---

test('the user id of a stored session is read without supabase-js, and only when it is text', () => {
  assert.equal(storedUserId(memory({ [KEY]: JSON.stringify({ access_token: 'x', user: { id: 'u-1' } }) }), KEY), 'u-1');
  for (const stored of [undefined, '', '{nope', 'null', '"a"', '[]', '{}', '{"user":null}', '{"user":{"id":7}}', '{"user":{"id":""}}']) {
    assert.equal(storedUserId(memory(stored === undefined ? {} : { [KEY]: stored }), KEY), null, String(stored));
  }
  const refuses = { getItem: () => { throw new Error('SecurityError'); } };
  assert.equal(storedUserId(refuses, KEY), null, 'blocked storage');
});

test("a device is new to an account when it has never held anyone's data, or held someone else's", () => {
  assert.equal(firstSyncHere(null, 'u-1'), true, 'no owner: the first sign-in on this browser');
  assert.equal(firstSyncHere(null, null), true, 'no owner, and no way to tell who is signing in');
  assert.equal(firstSyncHere('u-2', 'u-1'), true, 'another account was here last');
  assert.equal(firstSyncHere('u-1', 'u-1'), false, 'this account is back on its device');
  assert.equal(firstSyncHere('u-1', null), false, 'cannot tell who is signing in: assume the owner, and do not make a returning visitor wait');
});
