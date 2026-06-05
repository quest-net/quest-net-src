// src/migrations/contextMigrations.ts
import type { Migration } from "./types";
import { seedViewedTerrainsV260Migration } from "./v2_6_0_seedViewedTerrains";

/**
 * Ordered list of context-level (localStorage) migrations.
 * Add new entries in ascending version order.
 */
export const contextMigrations: Migration[] = [
	seedViewedTerrainsV260Migration,
];
