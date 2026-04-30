export interface Terrain {
	Id: string;
	Name: string;
	Width: number; // number of tiles wide
	Length: number; // number of tiles long
	HeightMap: number[][]; // elevation values [y][x]
	ColorMap: number[][]; // fixed terrain palette indices [y][x]
	Tags?: string[];
}

export const MAX_HEIGHT = 16;

/** Default starting elevation used when a new flat terrain is created. */
export const DEFAULT_TERRAIN_HEIGHT = 8;
