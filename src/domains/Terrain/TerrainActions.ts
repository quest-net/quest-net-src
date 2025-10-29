// domains/Terrain/TerrainActions.ts

import { Context } from "../Context/Context";
import { Terrain, TerrainType } from "./Terrain";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";

export const TerrainActions = {
	/**
	 * Creates the default terrain that every campaign starts with
	 * This terrain cannot be deleted and is always available
	 */
	createDefault(): Terrain {
		const width = 20;
		const length = 20;

		// Initialize empty height map (all 8s)
		const heightMap: number[][] = Array(length)
			.fill(null)
			.map(() => Array(width).fill(8));

		// Initialize color map (all white)
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

	/** Create a randomized hilly terrain with two colors by height */
	createHills(): Terrain {
		// Tunables — feel free to tweak
		const width = 32;
		const length = 32;
		const MAX_HEIGHT = 12; // integer height cap
		const HILLS_COUNT = 6; // number of hill centers
		const MIN_RADIUS = 3;
		const MAX_RADIUS = Math.floor(Math.min(width, length) / 3); // gentle slopes

		// Base arrays
		const heightFloat: number[][] = Array.from({ length }, () =>
			Array(width).fill(0)
		);
		const heightMap: number[][] = Array.from({ length }, () =>
			Array(width).fill(0)
		);
		const colorMap: TerrainType[][] = Array.from({ length }, () =>
			Array(width).fill("blue" as TerrainType)
		);

		// Random hill parameters
		const hills = Array.from({ length: HILLS_COUNT }, () => {
			const cx = Math.floor(Math.random() * width);
			const cy = Math.floor(Math.random() * length);
			const radius = Math.max(
				MIN_RADIUS,
				Math.floor(Math.random() * (MAX_RADIUS - MIN_RADIUS + 1)) + MIN_RADIUS
			);
			const peak = 0.6 + Math.random() * 0.8; // 0.6..1.4 (relative strength)
			const sigma2 = (radius * 0.45) ** 2; // gaussian falloff
			return { cx, cy, peak, sigma2 };
		});

		// Accumulate gaussian hills
		for (let y = 0; y < length; y++) {
			for (let x = 0; x < width; x++) {
				let v = 0;
				for (const h of hills) {
					const dx = x - h.cx;
					const dy = y - h.cy;
					const d2 = dx * dx + dy * dy;
					v += h.peak * Math.exp(-d2 / (2 * h.sigma2));
				}
				// Tiny ambient noise so flats aren’t perfectly uniform
				v += (Math.random() - 0.5) * 0.05;
				heightFloat[y][x] = Math.max(0, v);
			}
		}

		// Normalize to [4, MAX_HEIGHT] and quantize to integers
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
				const n = (heightFloat[y][x] - minV) / span; // 0..1
				const h = 4 + Math.round(n * MAX_HEIGHT); // 0..MAX_HEIGHT
				heightMap[y][x] = h;
			}
		}

		// Two-color ramp by elevation: green (low) → brown (high)
		const threshold = Math.floor(MAX_HEIGHT * 0.45);
		for (let y = 0; y < length; y++) {
			for (let x = 0; x < width; x++) {
				colorMap[y][x] = heightMap[y][x] > threshold ? "green" : "blue";
			}
		}

		// Produce Terrain object
		return {
			Id: `DEFAULT_HILLS`,
			Name: "Random Hills",
			Width: width,
			Length: length,
			HeightMap: heightMap,
			ColorMap: colorMap,
		};
	},

	/**
	 * Creates a new blank terrain (for user-created terrains)
	 */
	createNew(): Terrain {
		const width = 20;
		const length = 20;

		// Initialize empty height map (all 0s)
		const heightMap: number[][] = Array(length)
			.fill(null)
			.map(() => Array(width).fill(0));

		// Initialize color map (all green)
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

	/**
	 * Creates a new terrain and adds it to the campaign
	 */
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

	/**
	 * Edits a terrain's properties
	 */
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
	},

	/**
	 * Deletes a terrain from the campaign
	 * Cannot delete the default terrain (DEFAULT_TERRAIN)
	 */
	delete(params: { terrainId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Prevent deletion of default terrain
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

		// Check if this terrain is currently active
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

	/**
	 * Sets a terrain as the active terrain for the game
	 * If terrainId is undefined, falls back to DEFAULT_TERRAIN
	 */
	setActive(params: { terrainId: string | undefined }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		if (params.terrainId) {
			// Verify terrain exists
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
			// Fall back to default terrain instead of clearing
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
	},

	/**
	 * Updates a single tile in the terrain
	 */
	updateTile(
		params: {
			terrainId: string;
			x: number;
			y: number;
			height?: number;
			color?: TerrainType;
		},
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		const terrain = campaign.Terrains.find((t) => t.Id === params.terrainId);
		if (!terrain) {
			console.warn(`Terrain not found: ${params.terrainId}`);
			return;
		}

		// Validate coordinates
		if (
			params.y < 0 ||
			params.y >= terrain.Length ||
			params.x < 0 ||
			params.x >= terrain.Width
		) {
			console.warn(`Invalid coordinates: (${params.x}, ${params.y})`);
			return;
		}

		// Update height if provided
		if (params.height !== undefined) {
			// Clamp to 0-16 range
			terrain.HeightMap[params.y][params.x] = Math.max(
				0,
				Math.min(16, params.height)
			);
		}

		// Update color if provided
		if (params.color !== undefined) {
			terrain.ColorMap[params.y][params.x] = params.color;
		}
	},

	/**
	 * Resizes a terrain (preserves existing data where possible)
	 */
	resize(
		params: {
			terrainId: string;
			newWidth: number;
			newLength: number;
		},
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		const terrain = campaign.Terrains.find((t) => t.Id === params.terrainId);
		if (!terrain) {
			console.warn(`Terrain not found: ${params.terrainId}`);
			return;
		}

		const { newWidth, newLength } = params;

		// Create new maps with default values
		const newHeightMap: number[][] = Array(newLength)
			.fill(null)
			.map(() => Array(newWidth).fill(0));

		const newColorMap: TerrainType[][] = Array(newLength)
			.fill(null)
			.map(() => Array(newWidth).fill("green" as TerrainType));

		// Copy existing data
		const copyLength = Math.min(terrain.Length, newLength);
		const copyWidth = Math.min(terrain.Width, newWidth);

		for (let y = 0; y < copyLength; y++) {
			for (let x = 0; x < copyWidth; x++) {
				newHeightMap[y][x] = terrain.HeightMap[y][x];
				newColorMap[y][x] = terrain.ColorMap[y][x];
			}
		}

		// Update terrain
		terrain.Width = newWidth;
		terrain.Length = newLength;
		terrain.HeightMap = newHeightMap;
		terrain.ColorMap = newColorMap;

		LogActions.create(
			{
				action: "Terrain resized",
				details: `${terrain.Name} resized to ${newWidth}×${newLength}`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Bulk edit tags for multiple terrains
	 */
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
};
