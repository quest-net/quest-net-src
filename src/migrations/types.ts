// src/migrations/types.ts
import type { MigrationStorage } from "./MigrationStorage";

/**
 * A single versioned migration step.
 *
 * Rules for implementations:
 *  - NO domain type imports. Use `(data as any).field` for all record access.
 *    This ensures migrations never break when TypeScript types are refactored.
 *  - Use `storage` for any cross-boundary operations (IDB reads/writes,
 *    localStorage access). Ignore it for pure in-place data transforms.
 *  - Additive schema changes (new optional fields) do NOT need a migration --
 *    handle absence with `?? defaultValue` at the read site instead.
 */
export interface Migration {
	/** The version this migration brings data UP TO. */
	version: string;

	/**
	 * Transform the raw data record.
	 * Must return the (mutated or replaced) data.
	 * May be async when IDB or other async storage is involved.
	 */
	migrate: (data: unknown, storage: MigrationStorage) => unknown | Promise<unknown>;
}
