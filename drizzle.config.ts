import type { Config } from 'drizzle-kit';

export default {
  schema: './packages/database/src/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/employment-agent.db',
  },
  verbose: true,
} satisfies Config;
