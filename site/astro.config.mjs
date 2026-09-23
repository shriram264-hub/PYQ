// @ts-check
import { defineConfig } from 'astro/config';

// The canonical origin. Switches to https://sawaalbox.com once that domain is
// registered; until then canonical URLs must point at the origin actually serving.
const site = process.env.SITE_URL || 'https://upsc-pyq-search-s778.onrender.com';

export default defineConfig({
  site,
  trailingSlash: 'never',
  // Directory format, not 'file': paginated routes put page 2 at
  // /upsc/subject/geography/2, which collides with a sibling geography.html
  // under file format and makes the clean URL redirect into a directory with
  // no index.
  build: {
    format: 'directory',
  },
});
