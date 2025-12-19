// utils/TerrainUtils.ts
// Terrain generation utilities - all functions are additive/subtractive
// They modify existing heightmaps rather than replacing them

import { MAX_HEIGHT } from "../domains/Terrain/Terrain";

type HeightMap = number[][];

const clamp = (v: number, min: number, max: number) =>
	Math.max(min, Math.min(max, v));

/**
 * Creates a deep copy of a 2D heightmap
 */
function cloneHeightMap(heightMap: HeightMap): HeightMap {
	return heightMap.map((row) => [...row]);
}

/**
 * Applies a gaussian bump at a specific location (additive)
 */
function applyGaussianBump(
	heightMap: HeightMap,
	cx: number,
	cy: number,
	radius: number,
	peakHeight: number,
	width: number,
	length: number
): void {
	const sigma2 = (radius * 0.5) ** 2;
	const r2 = radius * radius;

	for (let y = 0; y < length; y++) {
		for (let x = 0; x < width; x++) {
			const dx = x - cx;
			const dy = y - cy;
			const d2 = dx * dx + dy * dy;

			if (d2 < r2 * 4) {
				// Only compute within reasonable range
				const falloff = Math.exp(-d2 / (2 * sigma2));
				heightMap[y][x] = clamp(
					Math.round(heightMap[y][x] + peakHeight * falloff),
					0,
					MAX_HEIGHT
				);
			}
		}
	}
}

/**
 * Random Hills - Adds smooth gaussian hills across the terrain
 * Creates 3-6 overlapping hills with varying sizes
 */
export function applyRandomHills(
	heightMap: HeightMap,
	width: number,
	length: number
): HeightMap {
	const result = cloneHeightMap(heightMap);

	const minDim = Math.min(width, length);
	const hillCount = 3 + Math.floor(Math.random() * 4); // 3-6 hills
	const minRadius = Math.max(2, minDim / 8);
	const maxRadius = Math.max(4, minDim / 3);

	for (let i = 0; i < hillCount; i++) {
		const cx = Math.random() * width;
		const cy = Math.random() * length;
		const radius = minRadius + Math.random() * (maxRadius - minRadius);
		const peak = 3 + Math.random() * 5; // 3-8 height addition

		applyGaussianBump(result, cx, cy, radius, peak, width, length);
	}

	return result;
}

/**
 * Random Trees - Adds scattered pillar-like structures
 * Creates single tiles or small 2x2 clusters raised up
 */
export function applyRandomTrees(
	heightMap: HeightMap,
	width: number,
	length: number
): HeightMap {
	const result = cloneHeightMap(heightMap);

	const area = width * length;
	const treeCount = Math.floor(area / 40) + Math.floor(Math.random() * 2); // Density based on area

	for (let i = 0; i < treeCount; i++) {
		const x = Math.floor(Math.random() * width);
		const y = Math.floor(Math.random() * length);
		const treeHeight = 6 + Math.floor(Math.random() * 2); // 2-5 height
		const isCluster = Math.random() < 0.3; // 30% chance for 2x2 cluster

		result[y][x] = clamp(result[y][x] + treeHeight, 0, MAX_HEIGHT);

		if (isCluster) {
			// Add adjacent tiles for cluster
			const offsets = [
				[1, 0],
				[0, 1],
				[1, 1],
			];
			for (const [ox, oy] of offsets) {
				const nx = x + ox;
				const ny = y + oy;
				if (nx < width && ny < length) {
					const clusterHeight = treeHeight - Math.floor(Math.random() * 2);
					result[ny][nx] = clamp(
						result[ny][nx] + clusterHeight,
						0,
						MAX_HEIGHT
					);
				}
			}
		}
	}

	return result;
}

/**
 * Random Islands - Creates raised plateau regions
 * Uses cellular automata-like approach for organic shapes
 */
export function applyRandomIslands(
	heightMap: HeightMap,
	width: number,
	length: number
): HeightMap {
	const result = cloneHeightMap(heightMap);

	const islandCount = 2 + Math.floor(Math.random() * 3); // 2-4 islands
	const minDim = Math.min(width, length);

	for (let i = 0; i < islandCount; i++) {
		// Island center and rough size
		const cx = Math.floor(Math.random() * width);
		const cy = Math.floor(Math.random() * length);
		const baseRadius = minDim / 6 + Math.random() * (minDim / 4);
		const plateauHeight = 3 + Math.floor(Math.random() * 4); // 3-6 height

		// Create irregular island shape using noise
		for (let y = 0; y < length; y++) {
			for (let x = 0; x < width; x++) {
				const dx = x - cx;
				const dy = y - cy;
				const dist = Math.sqrt(dx * dx + dy * dy);

				// Add some irregularity to the edge
				const angle = Math.atan2(dy, dx);
				const noiseOffset =
					Math.sin(angle * 3) * baseRadius * 0.2 +
					Math.sin(angle * 7) * baseRadius * 0.1;
				const effectiveRadius = baseRadius + noiseOffset;

				if (dist < effectiveRadius * 0.6) {
					// Inner plateau - full height
					result[y][x] = clamp(
						Math.round(result[y][x] + plateauHeight),
						0,
						MAX_HEIGHT
					);
				} else if (dist < effectiveRadius) {
					// Edge - gradual falloff
					const edgeFactor = 1 - (dist - effectiveRadius * 0.6) / (effectiveRadius * 0.4);
					const edgeHeight = Math.round(plateauHeight * edgeFactor);
					result[y][x] = clamp(result[y][x] + edgeHeight, 0, MAX_HEIGHT);
				}
			}
		}
	}

	return result;
}

/**
 * Random Valley - Carves a meandering valley through the terrain (subtractive)
 * Creates a path that lowers terrain along its route
 */
export function applyRandomValley(
	heightMap: HeightMap,
	width: number,
	length: number
): HeightMap {
	const result = cloneHeightMap(heightMap);

	// Determine valley direction (horizontal or vertical bias)
	const isHorizontal = Math.random() < 0.5;

	// Valley parameters
	const valleyDepth = 3 + Math.floor(Math.random() * 3); // 3-5 depth
	const valleyWidth = Math.max(2, Math.min(width, length) / 6);

	// Generate meandering path points
	const points: { x: number; y: number }[] = [];
	const segments = 6 + Math.floor(Math.random() * 4); // 6-9 control points

	if (isHorizontal) {
		// Valley runs roughly left to right
		for (let i = 0; i <= segments; i++) {
			const t = i / segments;
			const x = t * width;
			const baseY = length / 2;
			const wobble = (Math.random() - 0.5) * length * 0.4;
			points.push({ x, y: baseY + wobble });
		}
	} else {
		// Valley runs roughly top to bottom
		for (let i = 0; i <= segments; i++) {
			const t = i / segments;
			const y = t * length;
			const baseX = width / 2;
			const wobble = (Math.random() - 0.5) * width * 0.4;
			points.push({ x: baseX + wobble, y });
		}
	}

	// Apply valley along the path using linear interpolation between points
	for (let y = 0; y < length; y++) {
		for (let x = 0; x < width; x++) {
			// Find minimum distance to any path segment
			let minDist = Infinity;

			for (let i = 0; i < points.length - 1; i++) {
				const p1 = points[i];
				const p2 = points[i + 1];

				// Distance from point to line segment
				const dx = p2.x - p1.x;
				const dy = p2.y - p1.y;
				const len2 = dx * dx + dy * dy;

				let t = 0;
				if (len2 > 0) {
					t = clamp(((x - p1.x) * dx + (y - p1.y) * dy) / len2, 0, 1);
				}

				const projX = p1.x + t * dx;
				const projY = p1.y + t * dy;
				const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);

				minDist = Math.min(minDist, dist);
			}

			// Apply valley depth based on distance
			if (minDist < valleyWidth) {
				const factor = 1 - minDist / valleyWidth;
				const carveDepth = Math.round(valleyDepth * factor * factor);
				result[y][x] = clamp(result[y][x] - carveDepth, 0, MAX_HEIGHT);
			}
		}
	}

	return result;
}

/**
 * Flatten - Resets all heights to 0
 */
export function applyFlatten(
	_heightMap: HeightMap,
	width: number,
	length: number
): HeightMap {
	return Array.from({ length }, () => Array(width).fill(0));
}

/**
 * Smooth - Averages heights with neighbors to reduce jaggedness
 * Can be applied multiple times for more smoothing
 */
export function applySmooth(
	heightMap: HeightMap,
	width: number,
	length: number,
	iterations: number = 1
): HeightMap {
	let result = cloneHeightMap(heightMap);

	for (let iter = 0; iter < iterations; iter++) {
		const next = cloneHeightMap(result);

		for (let y = 0; y < length; y++) {
			for (let x = 0; x < width; x++) {
				let sum = result[y][x];
				let count = 1;

				// Check all 8 neighbors
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						if (dx === 0 && dy === 0) continue;
						const nx = x + dx;
						const ny = y + dy;
						if (nx >= 0 && nx < width && ny >= 0 && ny < length) {
							sum += result[ny][nx];
							count++;
						}
					}
				}

				next[y][x] = Math.round(sum / count);
			}
		}

		result = next;
	}

	return result;
}