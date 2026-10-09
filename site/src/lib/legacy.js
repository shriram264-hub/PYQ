// Pure rules for forwarding old subject and topic addresses. Kept free of the
// corpus so the generator script and the tests can share them without reading
// the question data.

/**
 * Where an old page's questions mostly went. `counts` maps a destination
 * address to how many of the old page's questions now live there. A tie goes to
 * the alphabetically first address, so regenerating the list never reshuffles.
 */
export function destinationOf(counts) {
  let best = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && key.localeCompare(best, 'en') < 0)) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * An old page 3 should land on page 3 of the destination when that page
 * exists. Otherwise (the destination is shorter) it lands on the first page,
 * because a page number the destination lacks would be a dead address.
 */
export function pagedDestination(sourcePage, destPath, destPages) {
  if (sourcePage <= 1 || sourcePage > destPages) return destPath;
  return `${destPath}/${sourcePage}`;
}
