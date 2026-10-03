/**
 * The stable identity of a question in user data. Never the `id` field of
 * questions.json: that is the question's position in the source PDF and is
 * renumbered by every re-extraction, which would silently repoint bookmarks.
 */
export function questionKey(exam, year, qNo) {
  return `${exam}-${year}-${qNo}`;
}

// Exactly the database's check on question_key (supabase/migrations/
// 20261002120000_accounts.sql). The account refuses any other shape, so a mark
// stored under one would fail every upload.
const ACCEPTED = /^[a-z]+-[0-9]{4}-[0-9]{1,3}$/;

/** A key the account will accept. */
export function isQuestionKey(key) {
  return typeof key === 'string' && ACCEPTED.test(key);
}
