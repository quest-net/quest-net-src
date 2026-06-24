// src/migrations/contextMigrations.ts
import type { Migration } from "./types";
import { seedViewedTerrainsV260Migration } from "./v2_6_0_seedViewedTerrains";
import { seedLastUpdatedV300Migration } from "./v3_0_0_seedLastUpdated";

/**
 * Ordered list of context-level (localStorage) migrations.
 * Add new entries in ascending version order.
 */
export const contextMigrations: Migration[] = [
	seedViewedTerrainsV260Migration,
	seedLastUpdatedV300Migration,
];
