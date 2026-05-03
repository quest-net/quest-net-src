// src/updates/types.ts
import type { Context } from "../domains/Context/Context";
import type { VersionString } from "../version";

export interface VersionedMigration {
  /** Target version after applying `up` */
  version: VersionString;

  /**
   * Migrate from the previous version up to `version`.
   * Must set context.version to `version` before returning.
   */
  update: (context: Context) => Context;

  /**
   * Migrate from `version` back down to the previous version.
   * Must set context.version to the previous version before returning.
   */
  reset: (context: Context) => Context;
}
