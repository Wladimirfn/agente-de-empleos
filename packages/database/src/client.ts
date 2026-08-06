import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema/index.js";
import { runWithLockRetry } from "./retry.js";

const DB_PATH = process.env.DATABASE_PATH ?? "data/employment-agent.db";

function findWorkspaceRoot(cwd: string): string | null {
	let current = path.resolve(cwd);

	while (true) {
		try {
			const manifest = JSON.parse(
				fs.readFileSync(path.join(current, "package.json"), "utf8"),
			) as { name?: unknown; workspaces?: unknown };
			if (manifest.name === "employment-agent" || manifest.workspaces !== undefined) {
				return current;
			}
		} catch {
			// Keep walking when a package manifest is absent or invalid.
		}

		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function resolveDbPath(
	dbPath = DB_PATH,
	cwd = process.cwd(),
): string {
	if (path.isAbsolute(dbPath)) return dbPath;
	return path.resolve(findWorkspaceRoot(cwd) ?? cwd, dbPath);
}

function ensureDir(filePath: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

let _client: Client | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function buildClient(): Client {
	const absoluteDbPath = resolveDbPath();
	ensureDir(absoluteDbPath);
	return createClient({ url: `file:${absoluteDbPath}` });
}

async function applyPragmas(client: Client): Promise<void> {
	// libsql execute accepts PRAGMA statements directly via `.execute()`.
	// We run them sequentially because each PRAGMA connection-scope.
	await client.execute("PRAGMA journal_mode = WAL");
	await client.execute("PRAGMA foreign_keys = ON");
	await client.execute("PRAGMA busy_timeout = 5000");
}

export function getDb() {
	if (_db === null) {
		_client = buildClient();
		_db = drizzle(_client, { schema });
	}
	return _db;
}

export function getClient(): Client {
	if (_client === null) {
		_client = buildClient();
	}
	return _client;
}

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
	get(_target, prop) {
		const inner = getDb();
		const value = Reflect.get(inner as object, prop);
		return typeof value === "function" ? value.bind(inner) : value;
	},
});

export async function initDb(): Promise<void> {
	const client = getClient();
	await applyPragmas(client);
	// touch db to ensure migrations folder check happens
	getDb();
}

export function resolveMigrationsFolder(cwd = process.cwd()): string | null {
	const candidates = [
		path.resolve(cwd, 'drizzle/migrations'),
		path.resolve(cwd, '../../drizzle/migrations'),
	];
	return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * True when the error is a transient SQLite lock that the caller should
 * retry. Drizzle's `migrate` wraps the libsql client which already
 * waits up to `busy_timeout` (5000ms) for the lock, but the web's
 * middleware can race the worker's boot path and sometimes lose the
 * 5s window. In that case we retry the migrate call from the top.
 */

const MIGRATION_RETRY_ATTEMPTS = 5;
const MIGRATION_RETRY_BASE_MS = 200;

export async function runMigrations(): Promise<void> {
  await initDb();
  const migrationsFolder = resolveMigrationsFolder();
  if (migrationsFolder === null) return;
  await runWithLockRetry(
    () => migrate(getDb(), { migrationsFolder }),
    {
      attempts: MIGRATION_RETRY_ATTEMPTS,
      baseDelayMs: MIGRATION_RETRY_BASE_MS,
      operation: 'runMigrations',
    },
  );
}

export async function closeDb(): Promise<void> {
	if (_client !== null) {
		await _client.close();
		_client = null;
		_db = null;
	}
}

export type DB = ReturnType<typeof drizzle>;
export { schema };
