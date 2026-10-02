import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageKeyFor } from '../src/lib/accounts/config.js';

test('derives supabase-js session storage key from the project URL', () => {
  assert.equal(storageKeyFor('https://fcmwzpokqufvkojcqaxo.supabase.co'), 'sb-fcmwzpokqufvkojcqaxo-auth-token');
});
