// src/migrations/runMigrations.ts
import type { Migration } from "./types";
import type { MigrationStorage } from "./MigrationStorage";
import { DefaultMigrationStorage } from "./MigrationStorage";

/**
 * Compares two semver-like version strings (e.g. "1.2.3").
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

/**
 * Runs all registered migrations whose version is strictly newer than
 * `fromVersion`, in ascending version order.
 *
 * Returns the (possibly mutated) data after all applicable migrations run.
 *
 * @param data        The raw data to migrate. Typed as unknown -- migrations
 *                    must not import domain types; use `(data as any).field`.
 * @param fromVersion The version string stamped on the stored record.
 * @param migrations  List of available migrations, sorted ascending by version.
 * @param storage     Optional storage override (defaults to DefaultMigrationStorage).
 */
export async function runMigrations(
	data: unknown,
	fromVersion: string,
	migrations: Migration[],
	storage?: MigrationStorage
): Promise<unknown> {
	if (migrations.length === 0) return data;

	const store = storage ?? new DefaultMigrationStorage();
	let current = data;

	for (const migration of migrations) {
		if (compareVersions(migration.version, fromVersion) > 0) {
			current = await migration.migrate(current, store);
		}
	}

	return current;
}
