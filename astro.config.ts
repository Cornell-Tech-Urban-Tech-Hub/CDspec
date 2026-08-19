import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import UnoCSS from 'unocss/astro';

export default defineConfig({
  site: 'https://cdspec.urbanforward.tech',  // Repository name as base path
  base: '/', // Explicitly define base path for all site URLs
  trailingSlash: 'ignore',
  integrations: [
    // /embed/ is a frame target for other sites, not a destination page.
    // It is noindex, so keep it out of the sitemap too.
    sitemap({ filter: (page) => !page.includes('/embed') }),
    react(),
    UnoCSS(),
  ],
  vite: {
    plugins: [],
    ssr: {
      noExternal: ['maplibre-gl', '@deck.gl/core', '@deck.gl/layers', '@deck.gl/mapbox']
    },
    build: {
      dynamicImportVarsOptions: {
        warnOnError: true,
      },
      commonjsOptions: {
        include: [/node_modules/]
      }
    },
    optimizeDeps: {
      include: ['maplibre-gl', '@deck.gl/core', '@deck.gl/layers', '@deck.gl/mapbox'],
    }
  },
});