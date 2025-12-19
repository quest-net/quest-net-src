// src/updates/migrator.ts
import type { Context } from "../domains/Context/Context";
import { APP_VERSION, type VersionString } from "../version";
import type { VersionedMigration } from "./types";

// Import migrations here as you add them:
import { migration_1_0_3 } from "./update-1.0.3";
import { migration_1_0_5 } from "./update-1.0.5";
import { migration_1_0_6 } from "./update-1.0.6";
import { migration_1_0_7 } from "./update-1.0.7";
import { migration_1_1_0 } from "./update-1.1.0";
// etc.

const MIGRATIONS: VersionedMigration[] = [
  migration_1_0_3,
  migration_1_0_5,
  migration_1_0_6,
  migration_1_0_7,
  migration_1_1_0,
  // ...
];

// --- Version helpers ---

function parseVersion(version: string): [number, number, number] {
  const [major, minor, patch] = version
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0);
  return [major, minor, patch];
}

function compareVersions(a: VersionString, b: VersionString): number {
  const [aMaj, aMin, aPat] = parseVersion(a);
  const [bMaj, bMin, bPat] = parseVersion(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

// --- Core API ---

export function runMigrations(
  context: Context,
  targetVersion: VersionString = APP_VERSION
): Context {
  const storedVersion = (context.version ?? "1.0.0") as VersionString;
  const cmp = compareVersions(storedVersion, targetVersion);

  if (cmp === 0) {
    // Already the right version
    return context;
  }

  if (cmp < 0) {
    // stored < app → upgrade
    return migrateUp(context, storedVersion, targetVersion);
  } else {
    // stored > app → downgrade
    return migrateDown(context, storedVersion, targetVersion);
  }
}

function migrateUp(
  context: Context,
  from: VersionString,
  to: VersionString
): Context {
  const sorted = MIGRATIONS
    .slice()
    .sort((a, b) => compareVersions(a.version, b.version));

  let current = from;

  for (const migration of sorted) {
    // Skip migrations at or below current version
    if (compareVersions(migration.version, current) <= 0) continue;

    // Stop once migration.version > target
    if (compareVersions(migration.version, to) > 0) break;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[Updates] Applying update to ${migration.version} (from ${current})`
      );
    }

    const before = context.version;

    context = migration.update(context);

    if (context.version !== migration.version) {
      console.warn(
        `[Updates] Migration to ${migration.version} did not set context.version. ` +
        `Forcing it (was "${context.version}" from "${before}")`
      );
      context.version = migration.version;
    }

    current = context.version as VersionString;
  }

  return context;
}

function migrateDown(
  context: Context,
  from: VersionString,
  to: VersionString
): Context {
  const sorted = MIGRATIONS
    .slice()
    .sort((a, b) => compareVersions(a.version, b.version))
    .reverse();

  let current = from;

  for (const migration of sorted) {
    // Skip migrations above current
    if (compareVersions(migration.version, current) > 0) continue;

    // Stop once migration.version <= target
    if (compareVersions(migration.version, to) <= 0) break;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[Updates] Applying reset for ${migration.version} (from ${current})`
      );
    }

    const before = context.version;
    context = migration.reset(context);

    if (context.version === before) {
      console.warn(
        `[Updates] Reset for ${migration.version} did not change context.version. ` +
        `Make sure reset() sets it to the previous version explicitly.`
      );
    }

    current = context.version as VersionString;
  }

  return context;
}
