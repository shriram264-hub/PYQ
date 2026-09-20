// @ts-check
import { defineConfig } from 'astro/config';

// The canonical origin. Switches to https://sawaalbox.com once that domain is
// registered; until then canonical URLs must point at the origin actually serving.
const site = process.env.SITE_URL || 'https://upsc-pyq-search-s778.onrender.com';

export default defineConfig({
  site,
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
});
