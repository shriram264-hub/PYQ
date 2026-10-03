// @ts-check
import { defineConfig } from 'astro/config';

// The canonical origin. The old Render address still serves the same pages, so
// canonical URLs point here to keep search engines on one address.
const site = process.env.SITE_URL || 'https://sawaalbox.in';

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
