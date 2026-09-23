import {
  ALL_QUESTIONS,
  SUBJECTS,
  YEARS,
  SUBSTANTIAL_SUBTOPICS,
} from '../lib/corpus.js';
import { PAGE_SIZE } from './upsc/subject/[slug]/[...page].astro';

/**
 * Thin pages are deliberately excluded: a subject with 1 question is not worth
 * a crawl budget, and asking for it to be indexed invites a thin-content
 * judgement across the whole site.
 */
const INDEXABLE_SUBJECTS = SUBJECTS.filter((s) => s.count >= 5);

export async function GET({ site }) {
  const origin = site.href.replace(/\/$/, '');
  const urls = [];

  const add = (path, priority) => urls.push({ loc: `${origin}${path}`, priority });

  add('', '1.0');
  add('/upsc/subjects', '0.9');
  add('/upsc/years', '0.9');

  for (const subject of INDEXABLE_SUBJECTS) {
    const pages = Math.ceil(subject.count / PAGE_SIZE);
    for (let p = 1; p <= pages; p += 1) {
      add(p === 1 ? `/upsc/subject/${subject.slug}` : `/upsc/subject/${subject.slug}/${p}`, '0.8');
    }
  }

  for (const { year, count } of YEARS) {
    const pages = Math.ceil(count / PAGE_SIZE);
    for (let p = 1; p <= pages; p += 1) {
      add(p === 1 ? `/upsc/year/${year}` : `/upsc/year/${year}/${p}`, '0.8');
    }
  }

  for (const topic of SUBSTANTIAL_SUBTOPICS) {
    const pages = Math.ceil(topic.count / PAGE_SIZE);
    for (let p = 1; p <= pages; p += 1) {
      const base = `/upsc/topic/${topic.subjectSlug}/${topic.slug}`;
      add(p === 1 ? base : `${base}/${p}`, '0.7');
    }
  }

  for (const q of ALL_QUESTIONS) {
    add(`/upsc/question/${q.slug}`, '0.6');
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`)
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
