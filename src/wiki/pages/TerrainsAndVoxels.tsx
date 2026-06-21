import {
	WikiCallout,
	WikiCardGrid,
	WikiCode,
	WikiDiagram,
	WikiDiagramNode,
	WikiFieldGrid,
	WikiFlow,
	WikiFlowStep,
	WikiHighlight,
	WikiPageLink,
} from "../components/content";
import type { WikiPage } from "./WikiPage";

export const terrainsAndVoxelsPage: WikiPage = {
	slug: "terrains-and-voxels",
	title: "Terrains & Voxels",
	audience: "Developer",
	category: "Technical",
	summary: "How voxel terrains are modeled, encoded, stored, edited, rendered, and used for movement.",
	tags: ["terrain", "voxel", "svo", "indexeddb", "movement", "rendering"],
	icon: "icon-[mdi--cube-outline]",
	sections: [
		{
			id: "model",
			title: "Data Model",
			body: (
				<div className="space-y-4">
					<p>
						<WikiCode>VoxelTerrain</WikiCode> is the campaign-owned map object.
						Its dimensions are expressed in tactical units, while individual voxel
						coordinates are subcells controlled by{" "}
						<WikiHighlight tone="primary">Resolution</WikiHighlight>.
					</p>
					<WikiCallout tone="warning" title="The voxel payload is not on this object">
						<p>
							The canonical <WikiCode>VoxelTerrain</WikiCode> carries only
							metadata — never the voxel bytes. The SVO byte payload lives
							per-client in the in-memory <WikiCode>TerrainPayloadStore</WikiCode>{" "}
							and OPFS; only the <WikiCode>ContentHash</WikiCode> rides along
							on the synced campaign. Code that needs the payload reads it from
							the store, or carries an explicit{" "}
							<WikiCode>EditableVoxelTerrain</WikiCode> (terrain plus its{" "}
							<WikiCode>Voxels</WikiCode> string) through transient editor and
							stamp pipelines.
						</p>
					</WikiCallout>
					<WikiFieldGrid
						items={[
							{
								name: "Width / Length / Height",
								tone: "primary",
								detail:
									"Tactical extents. Gameplay coordinates stay in tactical units even when voxel resolution increases.",
							},
							{
								name: "Resolution",
								tone: "secondary",
								detail:
									"Voxels per tactical unit. Current editor options clamp this from 1 through 4.",
							},
							{
								name: "ContentHash",
								tone: "accent",
								detail:
									"Content-identity token for the voxel payload. This — not the payload itself — travels through state sync; clients compare it against their cached payload to decide whether to (re)fetch.",
							},
							{
								name: "Lighting / Background",
								tone: "success",
								detail:
									"Per-terrain environment settings used by the active map display and renderer.",
							},
							{
								name: "PreviewColor",
								tone: "info",
								detail:
									"Preview swatch color (a sampled voxel) maintained when terrain is saved or hydrated, used by the terrain library.",
							},
						]}
					/>
					<WikiDiagram title="Coordinate layers">
						<div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Tactical tile" tone="primary">
								Actors, movement, and map dimensions use familiar table units.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Voxel subcells" tone="secondary">
								Resolution splits each tactical unit into smaller editable cubes.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Encoded SVO" tone="accent">
								Occupied subcells are encoded compactly with palette indices.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
				</div>
			),
		},
		{
			id: "encoding",
			title: "Voxel Encoding",
			body: (
				<div className="space-y-4">
					<p>
						Voxel payloads are encoded by <WikiCode>VoxelDataUtils</WikiCode> as
						base64 strings, backed by the WASM SVO codec
						(<WikiCode>wasm/voxel-mesher</WikiCode>). The encoded format stores
						occupancy geometry and palette colors as separate streams.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Pack positions" tone="primary">
							Each voxel position is packed into one integer from x, y, and z
							byte coordinates.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Last write wins" tone="secondary">
							Encoding first folds voxels into a position-to-color map, so
							duplicate positions resolve to the latest color.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Build Morton-sorted tree" tone="accent">
							The codec builds a Sparse Voxel Octree using Morton path ordering
							and an 8-child mask per node.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Store color stream" tone="success">
							Colors are stored as a parallel byte stream in traversal order, with
							raw or RLE byte-stream encoding.
						</WikiFlowStep>
					</WikiFlow>
					<WikiCallout tone="info" title="O(1) count metadata">
						<p>
							<WikiCode>getVoxelCount</WikiCode> reads the count from the SVO
							header, so cheap emptiness checks can be made without decoding the
							full voxel set.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "storage",
			title: "Storage Lifecycle",
			body: (
				<div className="space-y-4">
					<p>
						Voxel payloads never live on the synced campaign object.{" "}
						<WikiCode>TerrainStorageService</WikiCode> backs a per-client
						materialized buffer (<WikiCode>TerrainPayloadStore</WikiCode>) with
						OPFS, and — for players — an on-demand peer fetch over the{" "}
						<WikiCode>terrainFetch</WikiCode> request action. A client
						materializes a terrain only when it needs to render or validate
						against it.
					</p>
					<WikiDiagram title="Hydration lifecycle">
						<div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Stub terrain" tone="warning">
								Canonical metadata + <WikiCode>ContentHash</WikiCode>; no payload
								materialized on this client.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Hydrate" tone="accent">
								Payload is loaded from the per-campaign{" "}
								<WikiCode>terrains</WikiCode> OPFS file when its hash matches, else
								fetched from the DM, into the per-client buffer.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Materialized terrain" tone="success">
								Voxels live in <WikiCode>TerrainPayloadStore</WikiCode>;{" "}
								<WikiCode>isHydrated</WikiCode> reports true. Dropped again when
								no longer pinned or occupied.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiFieldGrid
						items={[
							{
								name: "prepareCampaignAfterLoad",
								tone: "primary",
								detail:
									"Resets the payload store for the campaign, materializes pinned/occupied terrains, then drops the rest from the buffer.",
							},
							{
								name: "prepareCampaignForStorage",
								tone: "secondary",
								detail:
									"Persists every materialized terrain payload to OPFS. The campaign object stays payload-free either way.",
							},
							{
								name: "loadTerrainForEditing",
								tone: "accent",
								detail:
									"Returns an EditableVoxelTerrain (terrain + inline Voxels) for the editor's transient working copy.",
							},
							{
								name: "hydrateTerrain",
								tone: "info",
								detail:
									"Materializes a terrain into the per-client buffer from OPFS (hash match) or, for players, the DM over the network.",
							},
							{
								name: "deleteTerrain",
								tone: "error",
								detail:
									"Drops the buffered payload and deletes the OPFS file for the removed terrain.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "editor-pipeline",
			title: "Editor Pipeline",
			body: (
				<div className="space-y-4">
					<p>
						The editor decodes terrain into a mutable working grid with a color
						byte array and an occupancy bitset. Strokes mutate that grid, and the
						terrain is re-encoded at materialization boundaries.
					</p>
					<WikiDiagram title="Edit flow">
						<div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Encoded terrain" tone="primary">
								Saved <WikiCode>Voxels</WikiCode> payload.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="EditGrid" tone="accent">
								Flat indexed grid with occupancy and palette bytes.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Materialized terrain" tone="success">
								Re-encoded SVO string written back to the form/action path.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiCardGrid
						items={[
							{
								title: "Deltas",
								tone: "success",
								body:
									"Undo/redo normally stores changed cell states rather than full terrain snapshots.",
							},
							{
								title: "Reshape",
								tone: "warning",
								body:
									"Shape and resolution changes rescale voxel ranges, then clear editor history.",
							},
							{
								title: "Selections",
								tone: "accent",
								body:
									"Box and color selections batch place, erase, and paint operations over many cells.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "stamps-imports",
			title: "Stamps And Imports",
			body: (
				<div className="space-y-4">
					<p>
						Stamp terrain is normal terrain tagged into the stamp folder. The
						editor hydrates stamp sources on demand and enumerates their voxels as
						anchor-relative offsets.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Stamp source",
								tone: "primary",
								detail:
									"Any terrain tagged path:stamps, or a child path under it, excluding the terrain currently being edited.",
							},
							{
								name: "Transform order",
								tone: "secondary",
								detail:
									"Mirror on X first, then rotate clockwise in quarter turns around Y.",
							},
							{
								name: "Anchor",
								tone: "accent",
								detail:
									"Bottom-center of the source bounding box. Destination click position is added to these offsets.",
							},
							{
								name: "Resolution mismatch",
								tone: "warning",
								detail:
									"Source cells are expanded or contracted with the same range logic used by terrain reshape.",
							},
						]}
					/>
					<WikiCallout tone="info" title="VOX import">
						<p>
							The editor can parse VOX files, compute valid resolution options,
							and replace the current terrain while preserving the previous state
							in undo.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "terrain-index",
			title: "Runtime Index",
			body: (
				<div className="space-y-4">
					<p>
						<WikiCode>VoxelTerrainIndex</WikiCode> is the derived runtime view of a
						terrain. It avoids repeated full decodes for placement, raycasting,
						movement, and rendering helpers.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Occupancy",
								tone: "primary",
								detail:
									"Fast voxel existence checks by grid coordinate.",
							},
							{
								name: "Surface heights",
								tone: "success",
								detail:
									"Walkable top surfaces grouped by tactical tile and height.",
							},
							{
								name: "Resolution helpers",
								tone: "secondary",
								detail:
									"Conversions between voxel tops, tactical height, and rules height.",
							},
							{
								name: "Revision",
								tone: "accent",
								detail:
									"Stable revision data for cached adjacency and render work.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "actor-validation",
			title: "Actor Validation",
			body: (
				<div className="space-y-4">
					<p>
						Terrain changes can invalidate actor positions. The terrain action
						layer validates actors against map bounds, surfaces, occupied spaces,
						item placement rules, and flying clearance.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Normalize position" tone="primary">
							Actor x, y, and height are rounded or normalized into terrain rules
							coordinates.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Check surface or flight" tone="secondary">
							Standing actors need a matching surface. Flying actors need clear
							vertical space.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Check occupation" tone="warning">
							Non-item actors cannot share the same occupied position.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Repair or remove" tone="error">
							Invalid actors are moved to the nearest valid position when
							possible; unplaceable characters return to roster and entities are
							removed.
						</WikiFlowStep>
					</WikiFlow>
				</div>
			),
		},
		{
			id: "movement",
			title: "Movement",
			body: (
				<div className="space-y-4">
					<p>
						Voxel movement uses terrain surfaces as graph nodes. The movement
						system precomputes surface adjacency, then runs a Dijkstra-style search
						within the actor's movement budget.
					</p>
					<WikiCardGrid
						items={[
							{
								title: "Surface nodes",
								tone: "primary",
								body:
									"Movement keys include x, y, and height so stacked walkable surfaces in the same column remain distinct.",
							},
							{
								title: "Height costs",
								tone: "warning",
								body:
									"Climbing can add cost from the campaign movement settings lookup table.",
							},
							{
								title: "Flying extras",
								tone: "info",
								body:
									"Flying actors can maintain altitude over terrain and cross empty columns, with optional vertical-cost relief.",
							},
						]}
					/>
					<WikiCallout tone="success" title="Remaining range">
						<p>
							During combat, <WikiCode>TurnStartPosition</WikiCode> lets the
							movement overlay subtract spent movement and display only the
							remaining reachable tiles.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "rendering",
			title: "Rendering",
			body: (
				<div className="space-y-4">
					<p>
						Render geometry is built from decoded voxels into material buckets.
						Each bucket can become a separate draw call with its own material
						behavior.
					</p>
					<WikiDiagram title="Geometry build">
						<div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Decoded voxels" tone="primary">
								Voxel positions and palette indices.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Face pass" tone="accent">
								Cull hidden faces, bucket by material, and greedy-merge compatible
								faces.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Buffers" tone="success">
								Positions, normals, vertex colors, indices, heights, highlights,
								and occupancy texture data.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiCallout tone="accent" title="Material reference">
						<p>
							Special palette index behavior is documented in{" "}
							<WikiPageLink slug="materials">Materials</WikiPageLink>.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "networking",
			title: "Networking Notes",
			body: (
				<div className="space-y-4">
					<p>
						Terrain metadata is part of campaign sync, but large voxel payloads
						are packed and unpacked around campaign storage and broadcast paths.
						Active terrain payloads must be available for players to render and
						interact with the map.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Active terrain",
								tone: "primary",
								detail:
									"Hydrated during campaign load and terrain activation.",
							},
							{
								name: "Inactive terrain",
								tone: "secondary",
								detail:
									"Usually represented by metadata and storage key rather than a full voxel string.",
							},
							{
								name: "Player sanitization",
								tone: "warning",
								detail:
									"Storage keys are rewritten to use the public room code when state is prepared for players.",
							},
							{
								name: "Full sync repair",
								tone: "success",
								detail:
									"State sync can fall back to full campaign state when delta baselines drift.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Networking reference">
						<p>
							For the broader sync model, see{" "}
							<WikiPageLink slug="networking">Networking</WikiPageLink>.
						</p>
					</WikiCallout>
				</div>
			),
		},
	],
	searchText:
		"terrain voxel VoxelTerrain VoxelDataUtils voxelCodecWasm WASM Sparse Voxel Octree SVO TerrainStorageService OPFS OpfsUtilities IndexedDB hydration editor EditGrid stamps VOX import VoxelTerrainIndex movement actor validation rendering material buckets networking",
};

export default terrainsAndVoxelsPage;
