// src/updates/idb-migrator.ts
//
// Async migration chain for IndexedDB data.
// Runs after the sync context migration chain in ContextActions.load().
//
// Version tracking is independent of context.version — stored under
// IDB_VERSION_KEY in localStorage. Both chains share the same version
// string format (semver) and advance to APP_VERSION together, but
// either chain can have migrations at versions the other does not.

import type { Context } from "../domains/Context/Context";
import { LocalStorageUtilities } from "../utils/LocalStorageUtilities";
import { APP_VERSION, type VersionString } from "../version";
import type { IndexedDBMigration } from "./types";

// Register IDB migrations here in ascending version order:
import { idb_migration_1_6_0 } from "./idb-update-1.6.0";

const IDB_MIGRATIONS: IndexedDBMigration[] = [
  idb_migration_1_6_0,
  // future IDB migrations go here...
];

const IDB_VERSION_KEY = "quest-net-idb-version";

export function markIDBMigrationsComplete(
  targetVersion: VersionString = APP_VERSION
): void {
  LocalStorageUtilities.save(IDB_VERSION_KEY, targetVersion);
}

// --- Version helpers (mirrored from migrator.ts) ---

function parseVersion(version: string): [number, number, number] {
  const [major, minor, patch] = version
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0);
  return [major, minor, patch];
}

function compareVersions(a: string, b: string): number {
  const [aMaj, aMin, aPat] = parseVersion(a);
  const [bMaj, bMin, bPat] = parseVersion(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

// --- Core API ---

/**
 * Runs any pending IDB migrations in ascending version order,
 * then saves the new IDB version to localStorage.
 *
 * Migrations receive and return the full in-memory Context so they can
 * reshape context.Campaigns (Campaign[] → CampaignInfo[]) as part of
 * moving data into IndexedDB.
 */
export async function runIDBMigrations(
  context: Context,
  targetVersion: VersionString = APP_VERSION
): Promise<Context> {
  const storedVersion =
    (LocalStorageUtilities.load<string>(IDB_VERSION_KEY) ?? "0.0.0") as VersionString;

  const cmp = compareVersions(storedVersion, targetVersion);

  if (cmp === 0) {
    // Already up to date
    return context;
  }

  if (cmp < 0) {
    context = await migrateIDBUp(context, storedVersion, targetVersion);
  } else {
    context = await migrateIDBDown(context, storedVersion, targetVersion);
  }

  return context;
}

async function migrateIDBUp(
  context: Context,
  from: VersionString,
  to: VersionString
): Promise<Context> {
  const sorted = IDB_MIGRATIONS.slice().sort((a, b) =>
    compareVersions(a.version, b.version)
  );

  for (const migration of sorted) {
    if (compareVersions(migration.version, from) <= 0) continue;
    if (compareVersions(migration.version, to) > 0) break;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[IDB Updates] Applying IDB update to ${migration.version} (from ${from})`
      );
    }

    context = await migration.update(context);
    from = migration.version;
  }

  return context;
}

async function migrateIDBDown(
  context: Context,
  from: VersionString,
  to: VersionString
): Promise<Context> {
  const sorted = IDB_MIGRATIONS.slice()
    .sort((a, b) => compareVersions(a.version, b.version))
    .reverse();

  for (const migration of sorted) {
    if (compareVersions(migration.version, from) > 0) continue;
    if (compareVersions(migration.version, to) <= 0) break;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[IDB Updates] Applying IDB reset for ${migration.version} (from ${from})`
      );
    }

    context = await migration.reset(context);
    from = migration.version;
  }

  return context;
}
