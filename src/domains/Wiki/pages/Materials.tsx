import type { WikiPage } from "./WikiPage";

export const materialsPage: WikiPage = {
	slug: "materials",
	title: "Materials",
	audience: "Developer",
	category: "Technical",
	summary: "Technical notes on voxel palette materials and special material indices.",
	tags: ["terrain", "materials", "palette", "three.js", "rendering"],
	icon: "icon-[mdi--palette-outline]",
	sections: [
		{
			id: "palette",
			title: "Palette Indices",
			body: (
				<p>
					Normal voxel colors use the terrain palette. Special material indices live
					in the high palette range and map to named Three.js material buckets for
					surfaces like water, lava, glass, metals, and foliage.
				</p>
			),
		},
		{
			id: "materials",
			title: "Material Buckets",
			body: (
				<p>
					Material definitions are grouped under{" "}
					<code className="font-mono">src/components/Map/Terrain/materials</code>.
					The terrain renderer chooses buckets by palette index so special materials
					can render with distinct shaders, transparency, lighting, and surface
					behavior.
				</p>
			),
		},
		{
			id: "three",
			title: "Three.js Notes",
			body: (
				<p>
					Voxel materials should use <code className="font-mono">MeshStandardMaterial</code>.
					Three.js addon imports should use{" "}
					<code className="font-mono">three/examples/jsm/</code> paths in this project.
				</p>
			),
		},
	],
	searchText:
		"materials palette index special material voxel three.js MeshStandardMaterial water lava glass gold silver iron bars stone bricks grass wood",
};

export default materialsPage;
