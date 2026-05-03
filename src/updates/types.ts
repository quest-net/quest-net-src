// src/updates/types.ts
import type { VersionString } from "../version";

/**
 * Migrations operate on whatever historical Context shape was on disk for
 * their target version, which may differ from the current TypeScript type.
 * Typing the migration input/output as `any` keeps every existing migration
 * compiling without per-file rewrites — the migrator narrows back to
 * Context once all migrations have run.
 */
export interface VersionedMigration {
  /** Target version after applying `up` */
  version: VersionString;

  /**
   * Migrate from the previous version up to `version`.
   * Must set context.version to `version` before returning.
   */
  update: (context: any) => any;

  /**
   * Migrate from `version` back down to the previous version.
   * Must set context.version to the previous version before returning.
   */
  reset: (context: any) => any;
}
