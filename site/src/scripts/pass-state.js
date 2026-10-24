import { loadPassCache, savePassCache } from '../lib/payments/pass-cache.js';
import { currentPayments } from '../lib/payments/switch.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Brings this device's pass cache up to date with the account: the active
 * passes of the site's mode, saved for this user. Dispatches `sawaalbox:pass`
 * when what the device knows changed, so a page that gated itself redraws.
 *
 * With payments off nothing is asked and nothing saved. A request error throws
 * and leaves the old cache as it was (a failed request never
 * takes a paid student's access away); sync logs it and the next run retries.
 * Passes are only ever written by the server; this is a read.
 *
 * `payments` is injectable for tests; callers pass two arguments.
 */
export async function refreshPass(client, user, { payments = currentPayments() } = {}) {
  if (payments.state === 'off') return;
  const { data, error } = await client
    .from('passes')
    .select('exam,valid_until')
    .eq('status', 'active')
    .eq('mode', payments.mode);
  if (error) throw error;
  const passes = data
    .map((r) => ({ exam: r.exam, validUntil: r.valid_until }))
    .sort((a, b) => (a.exam < b.exam ? -1 : a.exam > b.exam ? 1 : a.validUntil < b.validUntil ? -1 : a.validUntil > b.validUntil ? 1 : 0));
  const next = { userId: user.id, mode: payments.mode, passes };
  if (same(loadPassCache(), next)) return;
  // Refused storage must not look like success: the pages would keep reading the old cache.
  if (!savePassCache(next)) throw new Error('the pass could not be saved on this device');
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('sawaalbox:pass'));
}
