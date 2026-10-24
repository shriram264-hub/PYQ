// The paid pass, kept in one place: /plans, /pricing, /refunds and /delivery all
// read it from here, and so will the payment build, so a change of price or
// date is one edit. Keyed by exam slug (see lib/exams.js).
//
// Payments are not switched on yet. Until they are, tests and analytics stay
// free for everyone; this module describes the pass as it will be sold.
//
// Dates are ISO strings and are spelled out for readers with longDate() in
// lib/legal.js, never by toLocaleDateString (see the note there).

const upsc = Object.freeze({
  exam: 'upsc',
  name: 'UPSC Prelims pass',
  // A one-time payment, not a subscription: nothing renews.
  price: 499,
  currency: 'INR',
  priceLabel: '₹499',
  // The last day the pass works: the day after the Prelims.
  validUntil: '2027-05-24',
  // UPSC's published calendar date for Civil Services Prelims 2027. UPSC says
  // its calendar dates can change.
  prelimsDate: '2027-05-23',
  // The four things the pass unlocks, in the words the pages print.
  unlocks: Object.freeze([
    'Unlimited full past papers and practice sets',
    'The “Your analytics” page',
    'Your accuracy line on subject and topic pages',
    'Revise the questions you got wrong',
  ]),
  // What a free account can try once payments start.
  taster: 'One full past paper and one practice set, with their results',
  // What stays free, with or without the pass.
  free: Object.freeze([
    'Reading and searching past questions',
    'Mark done and Needs review, and your revision lists',
    'The Revise page',
    'The basics on My progress',
  ]),
  // A full refund if the buyer has used no more than the free taster.
  refundDays: 7,
  // How long a refund usually takes to arrive after we approve it.
  refundTiming: 'typically within 5–7 working days after we approve it',
  // Access switches on at once; this is how long a buyer waits before writing.
  deliveryWaitHours: 1,
});

export const PASSES = Object.freeze({ upsc });

/** The pass for an exam slug, or undefined if that exam has none. */
export function passFor(exam) {
  return PASSES[exam];
}
