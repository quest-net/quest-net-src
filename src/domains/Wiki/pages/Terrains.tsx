import type { WikiPage } from "./WikiPage";

export const terrainsPage: WikiPage = {
	slug: "terrains",
	title: "Terrains",
	audience: "DM Guide",
	category: "Worldbuilding",
	summary: "How DMs create, edit, store, and use 3D voxel battle maps.",
	tags: ["terrain", "voxel", "map", "editor", "indexeddb"],
	icon: "icon-[mdi--terrain]",
	sections: [
		{
			id: "overview",
			title: "Terrain Overview",
			body: (
				<p>
					Quest-Net terrain is a voxel map used by the 3D battle view. A campaign can
					store many voxel terrains, while the active encounter points to one terrain
					through the campaign game state.
				</p>
			),
		},
		{
			id: "editor-modes",
			title: "Editor Modes",
			body: (
				<p>
					The terrain editor has a normal tactical-tile mode for broad map building
					and a sculpt mode for voxel-level brush work. DMs can paint, raise, lower,
					set, and undo terrain changes while preparing a scene.
				</p>
			),
		},
		{
			id: "storage",
			title: "Storage Model",
			body: (
				<p>
					Large voxel payloads are stored in IndexedDB through the terrain storage
					service. The campaign object keeps terrain metadata and may hold a stub until
					the voxel data is hydrated.
				</p>
			),
		},
	],
	searchText:
		"terrain terrains voxel map editor normal sculpt paint raise lower indexeddb storage game state VoxelTerrain TerrainStorageService",
};

export default terrainsPage;
