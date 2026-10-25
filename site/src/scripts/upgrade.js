import { PASS_KEY } from '../lib/payments/pass-cache.js';

// The Upgrade prompt (components/UpgradePrompt.astro): served hidden on every
// page where a pass can be needed, and shown by that page's script once the one
// access check (lib/tests/access.js) says no. This file decides nothing about
// access; it only finds the prompt, points its link and shows it.

/**
 * The address of /plans that comes back to this page: path and query, never
 * the fragment. `location` is window.location, or anything with a pathname and
 * a search.
 */
export function upgradeHref(location) {
  return '/plans?return=' + encodeURIComponent(location.pathname + location.search);
}

/** The page's prompt for `exam` and `feature` ('tests' | 'analytics'), or null. */
export function upgradeFor(exam, feature, root = document) {
  return (
    [...root.querySelectorAll('[data-upgrade]')].find((el) => el.dataset.exam === exam && el.dataset.feature === feature) ??
    null
  );
}

/** Shows the prompt `el`, its See the pass link leading back to this page as it now is. */
export function showUpgrade(el) {
  if (!el) return;
  const link = el.querySelector('[data-upgrade-link]');
  if (link) link.href = upgradeHref(globalThis.location);
  el.hidden = false;
}

/**
 * Calls `fn` whenever what this device knows of the student's passes may have
 * changed, so a gate can ask again. Three ways:
 *   - this tab's sync refreshed the cache (pass-state.js says so with
 *     `sawaalbox:pass`);
 *   - another tab did, the one a purchase was made in, which this tab hears
 *     only as a storage event: its own sync then finds the cache already up to
 *     date and says nothing;
 *   - the page came back from the back/forward cache (Back after buying in this
 *     tab), having heard nothing while it was away.
 */
export function onPassChange(fn) {
  document.addEventListener('sawaalbox:pass', () => fn());
  window.addEventListener('storage', (event) => {
    if (event.key === PASS_KEY || event.key === null) fn();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) fn();
  });
}
