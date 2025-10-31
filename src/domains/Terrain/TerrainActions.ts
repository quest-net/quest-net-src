// domains/Terrain/TerrainActions.ts

import { Context } from "../Context/Context";
import { Terrain, TerrainType } from "./Terrain";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { Actor } from "../Actor/Actor";

export const TerrainActions = {
	/**
	 * Creates the default terrain that every campaign starts with
	 * This terrain cannot be deleted and is always available
	 */
	createDefault(): Terrain {
		const width = 16;
		const length = 16;

		const heightMap: number[][] = Array(length)
			.fill(null)
			.map(() => Array(width).fill(8));

		const colorMap: TerrainType[][] = Array(length)
			.fill(null)
			.map(() => Array(width).fill("white" as TerrainType));

		return {
			Id: "DEFAULT_TERRAIN",
			Name: "Default Terrain",
			Width: width,
			Length: length,
			HeightMap: heightMap,
			ColorMap: colorMap,
		};
	},

	createHills(): Terrain {
		const width = 32;
		const length = 32;
		const MAX_HEIGHT = 12;
		const HILLS_COUNT = 6;
		const MIN_RADIUS = 3;
		const MAX_RADIUS = Math.floor(Math.min(width, length) / 3);

		const heightFloat: number[][] = Array.from({ length }, () =>
			Array(width).fill(0)
		);
		const heightMap: number[][] = Array.from({ length }, () =>
			Array(width).fill(0)
		);
		const colorMap: TerrainType[][] = Array.from({ length }, () =>
			Array(width).fill("blue" as TerrainType)
		);

		const hills = Array.from({ length: HILLS_COUNT }, () => {
			const cx = Math.floor(Math.random() * width);
			const cy = Math.floor(Math.random() * length);
			const radius = Math.max(
				MIN_RADIUS,
				Math.floor(Math.random() * (MAX_RADIUS - MIN_RADIUS + 1)) + MIN_RADIUS
			);
			const peak = 0.6 + Math.random() * 0.8;
			const sigma2 = (radius * 0.45) ** 2;
			return { cx, cy, peak, sigma2 };
		});

		for (let y = 0; y < length; y++) {
			for (let x = 0; x < width; x++) {
				let v = 0;
				for (const h of hills) {
					const dx = x - h.cx;
					const dy = y - h.cy;
					const d2 = dx * dx + dy * dy;
					v += h.peak * Math.exp(-d2 / (2 * h.sigma2));
				}
				v += (Math.random() - 0.5) * 0.05;
				heightFloat[y][x] = Math.max(0, v);
			}
		}

		let minV = Infinity,
			maxV = -Infinity;
		for (let y = 0; y < length; y++) {
			for (let x = 0; x < width; x++) {
				const v = heightFloat[y][x];
				if (v < minV) minV = v;
				if (v > maxV) maxV = v;
			}
		}
		const span = Math.max(1e-6, maxV - minV);
		for (let y = 0; y < length; y++) {
			for (let x = 0; x < width; x++) {
				const n = (heightFloat[y][x] - minV) / span;
				const h = 4 + Math.round(n * MAX_HEIGHT);
				heightMap[y][x] = h;
			}
		}

		const threshold = Math.floor(MAX_HEIGHT * 0.45);
		for (let y = 0; y < length; y++) {
			for (let x = 0; x < width; x++) {
				colorMap[y][x] = heightMap[y][x] > threshold ? "green" : "blue";
			}
		}

		return {
			Id: `DEFAULT_HILLS`,
			Name: "Random Hills",
			Width: width,
			Length: length,
			HeightMap: heightMap,
			ColorMap: colorMap,
		};
	},

	createNew(): Terrain {
		const width = 20;
		const length = 20;

		const heightMap: number[][] = Array(length)
			.fill(null)
			.map(() => Array(width).fill(0));

		const colorMap: TerrainType[][] = Array(length)
			.fill(null)
			.map(() => Array(width).fill("green" as TerrainType));

		return {
			Id: crypto.randomUUID(),
			Name: "New Terrain",
			Width: width,
			Length: length,
			HeightMap: heightMap,
			ColorMap: colorMap,
		};
	},

	create(params: { terrain: Terrain }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		campaign.Terrains.push(params.terrain);

		LogActions.create(
			{
				action: "Terrain created",
				details: `${params.terrain.Name} (${params.terrain.Width}×${params.terrain.Length})`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	edit(
		params: { terrainId: string; updates: Partial<Terrain> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		const terrain = campaign.Terrains.find((t) => t.Id === params.terrainId);
		if (!terrain) {
			console.warn(`Terrain not found: ${params.terrainId}`);
			return;
		}

		Object.assign(terrain, params.updates);

		LogActions.create(
			{
				action: "Terrain updated",
				details: terrain.Name,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);

		// Validate actors after terrain changes
		TerrainActions.validateActors(context);
	},

	delete(params: { terrainId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		if (params.terrainId === "DEFAULT_TERRAIN") {
			console.warn("Cannot delete the default terrain");
			return;
		}

		const index = campaign.Terrains.findIndex((t) => t.Id === params.terrainId);
		if (index === -1) {
			console.warn(`Terrain not found: ${params.terrainId}`);
			return;
		}

		const terrain = campaign.Terrains[index];

		if (campaign.GameState.TerrainId === params.terrainId) {
			console.warn(
				"Cannot delete active terrain. Switch to another terrain first."
			);
			return;
		}

		campaign.Terrains.splice(index, 1);

		LogActions.create(
			{
				action: "Terrain deleted",
				details: terrain.Name,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	setActive(params: { terrainId: string | undefined }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		if (params.terrainId) {
			const terrain = campaign.Terrains.find((t) => t.Id === params.terrainId);
			if (!terrain) {
				console.warn(`Terrain not found: ${params.terrainId}`);
				return;
			}

			campaign.GameState.TerrainId = params.terrainId;

			LogActions.create(
				{
					action: "Terrain activated",
					details: terrain.Name,
					category: "system",
					level: "important",
					visibility: ["all"],
				},
				context
			);
		} else {
			campaign.GameState.TerrainId = "DEFAULT_TERRAIN";

			LogActions.create(
				{
					action: "Terrain reset to default",
					category: "system",
					level: "info",
					visibility: ["all"],
				},
				context
			);
		}

		// Validate actors after terrain change
		TerrainActions.validateActors(context);
	},

	bulkEditTags(
		params: { updates: Array<{ terrainId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		let successCount = 0;
		params.updates.forEach((update) => {
			const terrain = campaign.Terrains.find((t) => t.Id === update.terrainId);
			if (terrain) {
				terrain.Tags = update.tags;
				successCount++;
			} else {
				console.warn(`Item not found for bulk update: ${update.terrainId}`);
			}
		});

		LogActions.create(
			{
				action: "terrains organized",
				details: `Updated tags for ${successCount} terrains(s)`,
				category: "scene",
				level: "verbose",
				visibility: ["dm"],
			},
			context
		);
	},

	// ============================================================================
	// VALIDATION SYSTEM
	// ============================================================================

	/**
	 * Validates all actors in the game state against the current terrain
	 * Fixes invalid positions, heights, and collisions
	 * Despawns actors that cannot be placed
	 */
	validateActors(context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const terrain = campaign.Terrains.find(
			(t) => t.Id === campaign.GameState.TerrainId
		);

		if (!terrain) {
			console.warn("No active terrain found for validation");
			return;
		}

		const occupiedTiles = new Set<string>();

		// Validate entities first (they have priority)
		TerrainActions.validateActorArray(
			campaign.GameState.Entities,
			terrain,
			occupiedTiles,
			"entity",
			context
		);

		// Then validate characters
		TerrainActions.validateActorArray(
			campaign.GameState.Characters,
			terrain,
			occupiedTiles,
			"character",
			context
		);
	},

	/**
	 * Validates an array of actors (either entities or characters)
	 */
	validateActorArray(
		actors: Actor[],
		terrain: Terrain,
		occupiedTiles: Set<string>,
		type: "entity" | "character",
		context: Context
	): void {
		const toRemove: string[] = [];

		for (const actor of actors) {
			const tileKey = `${actor.Position.x},${actor.Position.y}`;

			// Check if position is valid (in bounds and not occupied)
			const isValid =
				this.isInBounds(actor.Position.x, actor.Position.y, terrain) &&
				!occupiedTiles.has(tileKey);

			if (!isValid) {
				// Try to find a valid position
				const validPosition = this.findValidTile(terrain, occupiedTiles);

				if (validPosition) {
					// Found a spot - move actor there
					actor.Position.x = validPosition.x;
					actor.Position.y = validPosition.y;
					this.adjustHeight(actor, terrain);
					occupiedTiles.add(`${validPosition.x},${validPosition.y}`);
				} else {
					// No valid position found - mark for despawn
					toRemove.push(actor.Id);
				}
			} else {
				// Position is valid - just adjust height and mark as occupied
				this.adjustHeight(actor, terrain);
				occupiedTiles.add(tileKey);
			}
		}

		// Despawn actors that couldn't be placed
		for (const actorId of toRemove) {
			const index = actors.findIndex((a) => a.Id === actorId);
			if (index !== -1) {
				const actor = actors[index];
				actors.splice(index, 1);

				LogActions.create(
					{
						action: `${type} despawned`,
						details: `${actor.Name} was removed due to invalid position`,
						category: "system",
						level: "verbose",
						visibility: ["dm"],
						actorId: actor.Id,
					},
					context
				);
			}
		}
	},

	/**
	 * Checks if a position is within terrain bounds
	 */
	isInBounds(x: number, y: number, terrain: Terrain): boolean {
		return x >= 0 && x < terrain.Width && y >= 0 && y < terrain.Length;
	},

	/**
	 * Adjusts actor height based on terrain and flying ability
	 */
	adjustHeight(actor: Actor, terrain: Terrain): void {
		const terrainHeight = terrain.HeightMap[actor.Position.y][actor.Position.x];

		if (actor.CanFly) {
			// Flying actors: rise if terrain is taller, stay if terrain is shorter
			actor.Position.h = Math.max(actor.Position.h, terrainHeight);
		} else {
			// Ground actors: always at terrain height
			actor.Position.h = terrainHeight;
		}
	},

	/**
	 * Finds a valid unoccupied tile using spiral search from origin (0,0)
	 * Returns null if no valid tile found
	 */
	findValidTile(
		terrain: Terrain,
		occupiedTiles: Set<string>
	): { x: number; y: number } | null {
		// Start from origin
		let x = 0;
		let y = 0;

		// Check origin first
		if (this.isInBounds(x, y, terrain) && !occupiedTiles.has(`${x},${y}`)) {
			return { x, y };
		}

		// Spiral search outward
		let direction = 0; // 0: right, 1: down, 2: left, 3: up
		let stepsInDirection = 1;
		let stepsTaken = 0;
		let directionChanges = 0;

		const maxSearchRadius = terrain.Width * terrain.Length; // Search entire terrain
		let totalSteps = 0;

		while (totalSteps < maxSearchRadius) {
			// Move in current direction
			switch (direction) {
				case 0:
					x++;
					break; // right
				case 1:
					y++;
					break; // down
				case 2:
					x--;
					break; // left
				case 3:
					y--;
					break; // up
			}

			stepsTaken++;
			totalSteps++;

			// Check if this tile is valid
			if (this.isInBounds(x, y, terrain) && !occupiedTiles.has(`${x},${y}`)) {
				return { x, y };
			}

			// Change direction if needed
			if (stepsTaken === stepsInDirection) {
				stepsTaken = 0;
				direction = (direction + 1) % 4;
				directionChanges++;

				// Increase steps after every 2 direction changes
				if (directionChanges % 2 === 0) {
					stepsInDirection++;
				}
			}
		}

		// No valid tile found
		return null;
	},
};