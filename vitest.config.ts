import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'worker/**/*.test.ts', 'skills/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['packages/*/src/**/*.ts', 'apps/*/src/lib/**/*.ts', 'apps/*/src/components/islands/**/*.tsx'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@employment-agent/database': path.resolve(__dirname, 'packages/database/src'),
      '@employment-agent/domain': path.resolve(__dirname, 'packages/domain/src'),
      '@employment-agent/llm': path.resolve(__dirname, 'packages/llm/src'),
      '@employment-agent/resume-engine': path.resolve(__dirname, 'packages/resume-engine/src'),
      '@employment-agent/skill-runtime': path.resolve(__dirname, 'packages/skill-runtime/src'),
      '@employment-agent/browser': path.resolve(__dirname, 'packages/browser/src'),
      '@employment-agent/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
    conditions: ['node', 'import', 'module', 'default'],
  },
  optimizeDeps: {
    exclude: ['drizzle-orm', 'drizzle-orm/node-sqlite'],
  },
  server: {
    fs: { allow: ['..'] },
  },
});
