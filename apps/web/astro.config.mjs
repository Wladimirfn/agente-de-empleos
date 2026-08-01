import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
loadDotenv({ path: path.resolve(repoRoot, '.env'), quiet: true });

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
      alias: [
        { find: '@', replacement: '/src' },
        { find: /^@employment-agent\/database$/, replacement: new URL('../../packages/database/src/index.ts', import.meta.url).pathname },
        { find: /^@employment-agent\/database\/(.*)$/, replacement: new URL('../../packages/database/src/$1', import.meta.url).pathname },
        { find: /^@employment-agent\/domain$/, replacement: new URL('../../packages/domain/src/index.ts', import.meta.url).pathname },
        { find: /^@employment-agent\/domain\/(.*)$/, replacement: new URL('../../packages/domain/src/$1', import.meta.url).pathname },
        { find: /^@employment-agent\/llm$/, replacement: new URL('../../packages/llm/src/index.ts', import.meta.url).pathname },
        { find: /^@employment-agent\/llm\/(.*)$/, replacement: new URL('../../packages/llm/src/$1', import.meta.url).pathname },
        { find: /^@employment-agent\/resume-engine$/, replacement: new URL('../../packages/resume-engine/src/index.ts', import.meta.url).pathname },
        { find: /^@employment-agent\/resume-engine\/(.*)$/, replacement: new URL('../../packages/resume-engine/src/$1', import.meta.url).pathname },
        { find: /^@employment-agent\/skill-runtime$/, replacement: new URL('../../packages/skill-runtime/src/index.ts', import.meta.url).pathname },
        { find: /^@employment-agent\/skill-runtime\/(.*)$/, replacement: new URL('../../packages/skill-runtime/src/$1', import.meta.url).pathname },
        { find: /^@employment-agent\/shared$/, replacement: new URL('../../packages/shared/src/index.ts', import.meta.url).pathname },
        { find: /^@employment-agent\/shared\/(.*)$/, replacement: new URL('../../packages/shared/src/$1', import.meta.url).pathname },
      ],
    },
  },
});
