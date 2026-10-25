import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upgradeHref } from '../src/scripts/upgrade.js';

test('upgradeHref leads to /plans and back to this page, query and all', () => {
  assert.equal(upgradeHref({ pathname: '/upsc/test', search: '?x=1' }), '/plans?return=%2Fupsc%2Ftest%3Fx%3D1');
});

test('upgradeHref with no query, and a query that needs escaping', () => {
  assert.equal(upgradeHref({ pathname: '/upsc/analytics', search: '' }), '/plans?return=%2Fupsc%2Fanalytics');
  assert.equal(
    upgradeHref({ pathname: '/revise', search: '?wrong=upsc&a=b c' }),
    '/plans?return=%2Frevise%3Fwrong%3Dupsc%26a%3Db%20c'
  );
});

test('upgradeHref leaves out the fragment', () => {
  assert.equal(upgradeHref({ pathname: '/upsc/test', search: '', hash: '#practice' }), '/plans?return=%2Fupsc%2Ftest');
});
