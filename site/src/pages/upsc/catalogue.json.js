import { ALL_QUESTIONS } from '../../lib/corpus.js';
import { buildCatalogue } from '../../lib/tests/catalogue.js';

// /upsc/catalogue.json: the practice-set form's index of every question
// (lib/tests/catalogue.js). Fetched only when a student builds a set; question
// pages and the test screen never load it.
export function GET() {
  return new Response(JSON.stringify(buildCatalogue(ALL_QUESTIONS)), {
    headers: { 'Content-Type': 'application/json' },
  });
}
