import { paywallStart } from './switch.js';

/**
 * Whether the free taster of this kind ('paper' or 'custom') is spent: any
 * attempt of `exam` and `kind` begun since the paywall started, whatever became
 * of it. Counting abandoned ones too means starting and walking away cannot be
 * repeated for free tests. Attempts before the paywall do not count: they were
 * free to everyone. `tests` is the device's { attempts } (lib/tests/store.js).
 * `now` is unused today but keeps the signature the callers share.
 */
export function tasterUsed(tests, { exam, kind, from, now }) {
  void now;
  const start = paywallStart(from);
  if (Number.isNaN(start)) return false;
  return Object.values(tests.attempts).some(
    (a) => a.exam === exam && a.kind === kind && Date.parse(a.startedAt) >= start
  );
}
