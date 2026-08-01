import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: '../../drizzle/migrations',
  dialect: 'sqlite',
  verbose: true,
} satisfies Config;
