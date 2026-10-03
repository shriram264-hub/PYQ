import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasReturnParams, initialOf, withoutReturnParams } from '../src/scripts/auth.js';

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

// --- The sign-in return in the address. ---

test('a code or an error from sign-in is recognised in the query or the hash', () => {
  for (const url of [
    'https://sawaalbox.in/upsc?code=abc',
    'https://sawaalbox.in/upsc?error=access_denied&error_description=Denied',
    'https://sawaalbox.in/upsc#error=server_error&error_code=500&error_description=Oops',
    'https://sawaalbox.in/upsc?q=1#error_description=Oops',
  ]) {
    assert.equal(hasReturnParams(url), true, url);
  }
  for (const url of ['https://sawaalbox.in/upsc', 'https://sawaalbox.in/upsc/search?q=polity#contents', 'https://sawaalbox.in/#exams']) {
    assert.equal(hasReturnParams(url), false, url);
  }
});

test('cleaning removes only the sign-in parameters, from the query and the hash', () => {
  const clean = (url) => withoutReturnParams(url).toString();
  assert.equal(clean('https://sawaalbox.in/upsc/search?q=polity&code=abc#results'), 'https://sawaalbox.in/upsc/search?q=polity#results');
  assert.equal(
    clean('https://sawaalbox.in/upsc/search?q=polity#error=access_denied&error_code=403&error_description=Denied'),
    'https://sawaalbox.in/upsc/search?q=polity'
  );
  assert.equal(clean('https://sawaalbox.in/a?error=x#error=y&keep=1'), 'https://sawaalbox.in/a#keep=1');
  assert.equal(clean('https://sawaalbox.in/a?q=x#contents'), 'https://sawaalbox.in/a?q=x#contents', 'an ordinary hash is left alone');
});
