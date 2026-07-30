import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema/index.js";

const DB_PATH = process.env.DATABASE_PATH ?? "data/employment-agent.db";

function resolveDbPath(): string {
	return path.isAbsolute(DB_PATH)
		? DB_PATH
		: path.resolve(process.cwd(), DB_PATH);
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

export async function runMigrations(): Promise<void> {
	await initDb();
	const migrationsFolder = path.resolve(process.cwd(), "drizzle/migrations");
	if (fs.existsSync(migrationsFolder)) {
		migrate(getDb(), { migrationsFolder });
	}
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
