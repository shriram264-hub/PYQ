import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialOf } from '../src/scripts/auth.js';

// --- The initial on the account button. ---

test('the initial is the first letter of the name, upper-cased', () => {
  assert.equal(initialOf({ email: 'p@example.com', user_metadata: { full_name: 'priya Sharma' } }), 'P');
  assert.equal(initialOf({ email: 'p@example.com', user_metadata: { full_name: '  ñandu ' } }), 'Ñ');
  assert.equal(initialOf({ user_metadata: { full_name: 'श्रीराम' } }), 'श');
});

test('a blank name falls back to the email, then to a question mark, and never throws', () => {
  assert.equal(initialOf({ email: 'xavier@example.com', user_metadata: { full_name: '   ' } }), 'X');
  assert.equal(initialOf({ email: 'xavier@example.com', user_metadata: {} }), 'X');
  assert.equal(initialOf({ email: 'xavier@example.com' }), 'X');
  assert.equal(initialOf({ email: '', user_metadata: { full_name: '\n\t' } }), '?');
  assert.equal(initialOf({}), '?');
  assert.equal(initialOf({ user_metadata: { full_name: 7 } }), '?', 'a name that is not text is ignored');
});

test('a character outside the basic plane is one whole initial, not half of one', () => {
  assert.equal(initialOf({ user_metadata: { full_name: '𝒜da' } }), '𝒜');
  assert.equal(initialOf({ user_metadata: { full_name: '😀 Smile' } }), '😀');
});

test('a letter whose capital is two letters keeps its own form', () => {
  assert.equal(initialOf({ user_metadata: { full_name: 'ßtefan' } }), 'ß');
});
