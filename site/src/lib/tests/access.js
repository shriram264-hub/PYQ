// Every way into a test asks this first: the Start button on a paper, and the
// practice-set form. During the beta tests are free, so the answer is yes.
// Part 3 (payments) replaces this body with the entitlement check for `exam`;
// no other code may decide who can take a test (spec, "Future upgrade check").
// Async already, because that check will need the network.
export async function canStartTest(exam) {
  void exam;
  return true;
}
