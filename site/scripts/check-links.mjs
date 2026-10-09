/**
 * Crawls every built page and asserts that each internal link resolves to a
 * real file. Broken internal links are close to invisible by eye across 4,500
 * pages, and two separate rounds of them shipped before this existed.
 *
 *   node scripts/check-links.mjs        (run after `npm run build`)
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = 'dist';

const pages = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.html')) pages.push(full);
  }
})(ROOT);

const links = new Map();
for (const file of pages) {
  // Strip scripts first: client-side templates contain href="..." with
  // unevaluated placeholders that are not links.
  const html = readFileSync(file, 'utf-8').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const match of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    if (!links.has(match[1])) links.set(match[1], file);
  }
}

const resolves = (path) => {
  const clean = path.replace(/\/$/, '');
  if (clean === '') return true;
  return (
    existsSync(join(ROOT, clean, 'index.html')) ||
    existsSync(join(ROOT, `${clean}.html`)) ||
    existsSync(join(ROOT, clean))
  );
};

const broken = [...links].filter(([path]) => !resolves(path));

console.log(`checked ${pages.length} pages, ${links.size} unique internal links`);

if (broken.length) {
  console.error(`\n${broken.length} broken link(s):`);
  for (const [path, file] of broken.slice(0, 25)) {
    console.error(`  ${path}\n      first seen in ${file}`);
  }
  if (broken.length > 25) console.error(`  …and ${broken.length - 25} more`);
  process.exit(1);
}

console.log('all internal links resolve');

// Forwarding pages. data/legacy-urls.json lists the subject and topic addresses
// that stopped existing when the labels changed. Each must be built as a page
// that forwards, and must forward to a real page: not to another forwarding
// page (a redirect chain, or a loop), and not to a page that was never built.
const legacy = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../data/legacy-urls.json', import.meta.url)), 'utf-8')
);
const sitemapPaths = new Set(
  [...readFileSync(join(ROOT, 'sitemap.xml'), 'utf-8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => new URL(m[1]).pathname
  )
);

const pageFile = (path) => join(ROOT, path.replace(/^\//, ''), 'index.html');

/** Where the built page at `path` forwards to, or null if it is not a forwarding page. */
const forwardsTo = (path) => {
  const file = pageFile(path);
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf-8').match(/http-equiv="refresh" content="0; url=([^"]*)"/);
  return match ? match[1] : null;
};

const problems = [];
for (const [from, to] of Object.entries(legacy)) {
  const actual = forwardsTo(from);
  if (!existsSync(pageFile(from))) problems.push(`${from}: no forwarding page was built`);
  else if (actual === null) problems.push(`${from}: a real page was built here, not a forwarding page`);
  else if (actual !== to) problems.push(`${from}: forwards to ${actual}, expected ${to}`);

  if (!existsSync(pageFile(to))) problems.push(`${from}: destination ${to} is not a built page`);
  else if (to in legacy || forwardsTo(to) !== null) {
    problems.push(`${from}: destination ${to} is itself a forwarding page`);
  }

  // The sitemap is built from the question data, so it lists only real pages.
  // An old address appearing there means it is also a real page.
  if (sitemapPaths.has(from)) {
    problems.push(`${from}: is a real page as well as a forwarding page`);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) with forwarding pages:`);
  for (const line of problems.slice(0, 25)) console.error(`  ${line}`);
  if (problems.length > 25) console.error(`  …and ${problems.length - 25} more`);
  process.exit(1);
}

console.log(`all ${Object.keys(legacy).length} forwarding pages are built and point at real pages`);
