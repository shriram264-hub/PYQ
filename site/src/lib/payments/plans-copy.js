import { LEGAL } from '../legal.js';

// The status line's longest messages on /plans, shared by the page (which sizes
// the line's held room from them) and scripts/plans-page.js (which says them),
// so the room always fits what is said.

/** After a confirmation that did not come back (Global Constraints copy, verbatim). */
export const DROPPED = `If you were charged, your pass will switch on within a few minutes. If it hasn't after an hour, email ${LEGAL.email}.`;

/** Added under DROPPED once the page has stopped checking by itself. */
export const RELOAD = 'Reload this page to check again.';
