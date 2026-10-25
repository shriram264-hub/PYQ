import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturn } from '../src/lib/payments/return-path.js';

test('safeReturn keeps a path on this site, with its query and hash', () => {
  assert.equal(safeReturn('/upsc/test'), '/upsc/test');
  assert.equal(safeReturn('/upsc/test?x=1#a'), '/upsc/test?x=1#a');
  // What an Upgrade prompt sends, once URLSearchParams has decoded it.
  assert.equal(safeReturn('/upsc/test/take?paper=2019'), '/upsc/test/take?paper=2019');
  // An escaped space in a search stays as it was.
  assert.equal(safeReturn('/upsc/search?q=river%20dams'), '/upsc/search?q=river%20dams');
});

test('safeReturn refuses anything that could leave the site', () => {
  for (const raw of [
    '//evil.example',
    '/\\evil.example',
    'https://evil.example/x',
    'javascript:alert(1)',
    '/%2F%2Fevil.example',
    '/%5Cevil.example',
    '\\\\evil.example',
    '/\t/evil.example',
    'upsc/test',
  ]) {
    assert.equal(safeReturn(raw), null, raw);
  }
});

test('safeReturn refuses nothing, non-text and bad escapes', () => {
  assert.equal(safeReturn(''), null);
  assert.equal(safeReturn(null), null);
  assert.equal(safeReturn(undefined), null);
  assert.equal(safeReturn(42), null);
  assert.equal(safeReturn('/upsc/%E0%A4'), null);
});

test('safeReturn refuses a path longer than 512 characters', () => {
  assert.equal(safeReturn('/' + 'a'.repeat(599)), null);
  const longest = '/' + 'a'.repeat(511);
  assert.equal(safeReturn(longest), longest);
});
