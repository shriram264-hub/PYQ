// Every way into a test asks this first: the Start button on a paper, and the
// practice-set form. During the beta tests are free, so the answer is yes.
// Part 3 (payments) replaces this body with the entitlement check for `exam`;
// no other code may decide who can take a test (spec, "Future upgrade check").
// Async already, because that check will need the network.
export async function canStartTest(exam) {
  void exam;
  return true;
}

// The same for analytics: the analytics page, and the subject and topic line on
// the subject and topic pages, ask this before showing anything. Free during the
// beta; payments replace this body with the per-exam pass check, and no other
// code may decide who can see analytics.
export async function canSeeAnalytics(exam) {
  void exam;
  return true;
}
