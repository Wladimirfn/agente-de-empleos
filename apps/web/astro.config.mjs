import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
  ],
  server: {
    port: Number(process.env.WEB_PORT ?? 3000),
    host: true,
  },
  vite: {
    resolve: {
      alias: {
        '@': '/src',
        '@employment-agent/database': new URL('../../packages/database/src/index.ts', import.meta.url).pathname,
        '@employment-agent/domain': new URL('../../packages/domain/src/index.ts', import.meta.url).pathname,
        '@employment-agent/llm': new URL('../../packages/llm/src/index.ts', import.meta.url).pathname,
      },
    },
  },
});
