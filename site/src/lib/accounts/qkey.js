/**
 * The stable identity of a question in user data. Never the `id` field of
 * questions.json: that is the question's position in the source PDF and is
 * renumbered by every re-extraction, which would silently repoint bookmarks.
 */
export function questionKey(exam, year, qNo) {
  return `${exam}-${year}-${qNo}`;
}
