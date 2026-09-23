/**
 * Crawls every built page and asserts that each internal link resolves to a
 * real file. Broken internal links are close to invisible by eye across 4,500
 * pages, and two separate rounds of them shipped before this existed.
 *
 *   node scripts/check-links.mjs        (run after `npm run build`)
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
