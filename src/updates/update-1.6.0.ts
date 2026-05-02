// src/updates/update-1.6.0.ts
//
// Sync context migration for v1.6.0.
//
// The bulk of this version's work (moving campaigns into IndexedDB) is handled
// by the async IDB migration in idb-update-1.6.0.ts, which runs immediately
// after this chain completes. This sync migration only bumps the version so
// the IDB migrator knows it has work to do.

import type { Context } from "../domains/Context/Context";
import type { VersionedMigration } from "./types";

export const migration_1_6_0: VersionedMigration = {
  version: "1.6.0",

  update(context: Context): Context {
    return {
      ...context,
      version: "1.6.0",
    };
  },

  reset(context: Context): Context {
    return {
      ...context,
      version: "1.5.1",
    };
  },
};
