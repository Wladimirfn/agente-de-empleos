import type { Config } from "drizzle-kit";

export default {
	schema: "./packages/database/src/schema/*.ts",
	out: "./drizzle/migrations",
	dialect: "sqlite",
	dbCredentials: {
		url: process.env.DATABASE_PATH ?? "data/employment-agent.db",
	},
	verbose: true,
	strict: true,
} satisfies Config;
