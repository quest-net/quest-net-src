import {
	WikiCallout,
	WikiCardGrid,
	WikiDiagram,
	WikiDiagramNode,
	WikiFieldGrid,
	WikiFlow,
	WikiFlowStep,
	WikiHighlight,
	WikiPageLink,
} from "../components/content";
import type { WikiPage } from "./WikiPage";

export const terrainsPage: WikiPage = {
	slug: "terrains",
	title: "Terrains",
	audience: "DM Guide",
	category: "Worldbuilding",
	summary: "How DMs create, edit, organize, light, and use 3D battle maps.",
	tags: ["terrain", "map", "editor", "stamps", "lighting"],
	icon: "icon-[mdi--terrain]",
	sections: [
		{
			id: "overview",
			title: "What Terrains Are",
			body: (
				<div className="space-y-4">
					<p>
						Terrains are the 3D battle maps your table plays on. A campaign can
						have many terrains, and the DM chooses which one is active for the
						current scene.
					</p>
					<WikiDiagram title="DM terrain workflow">
						<div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Build" tone="success">
								Create rooms, cliffs, paths, platforms, obstacles, and scenic
								details in the terrain editor.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-60">
								-&gt;
							</div>
							<WikiDiagramNode title="Organize" tone="primary">
								Name terrains clearly and use tags or folders to group dungeons,
								towns, encounters, and reusable stamps.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-60">
								-&gt;
							</div>
							<WikiDiagramNode title="Run" tone="accent">
								View a map, adjust its atmosphere, and use "Move party here" to
								bring the visible group through the encounter.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiCallout tone="info" title="Player visibility">
						<p>
							Each player sees the terrain their selected character is standing on,
							so a split party can be on different maps at once. Treat unused maps
							as your prep library, and "Move party here" to bring the actors you're
							currently viewing to a new location.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "terrain-library",
			title: "Terrain Library",
			body: (
				<div className="space-y-4">
					<p>
						The terrain library is where you browse and manage all maps in the
						campaign. It works like other Quest-Net index pages: search by name,
						open a terrain to edit it, create new terrain, and use tags to keep
						your map collection tidy.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Create",
								tone: "success",
								detail:
									"Starts a new blank terrain that you can name, size, sculpt, tag, and save.",
							},
							{
								name: "Clone",
								tone: "primary",
								detail:
									"Makes a copy of an existing terrain. Useful for alternate versions, damaged rooms, phased encounters, or seasonal variants.",
							},
							{
								name: "View",
								tone: "accent",
								detail:
									"Switches your local view to that terrain (and targets it for spawns). It does not move any actor — use the Terrains panel's \"Move party here\" to relocate the visible group.",
							},
							{
								name: "Delete",
								tone: "error",
								detail:
									"Removes a terrain from the campaign. The active terrain is protected, so switch maps before deleting it.",
							},
							{
								name: "Tags",
								tone: "info",
								detail:
									"Organize terrain by location, chapter, dungeon level, encounter type, or stamp folders.",
							},
							{
								name: "Search",
								tone: "secondary",
								detail:
									"Quickly find maps by name when your campaign library grows.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "terrain-editor",
			title: "Terrain Editor",
			body: (
				<div className="space-y-4">
					<p>
						The terrain editor is the main map-building workspace. It has a header
						for map shape, a top tool bar for editing, a central 3D canvas, and a
						right-side panel for info, selections, colors, materials, actors, and
						preview settings.
					</p>
					<WikiDiagram title="Editor layout">
						<div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Top fields" tone="primary">
								Name, width, length, height, and detail level.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-60">
								-&gt;
							</div>
							<WikiDiagramNode title="Canvas and toolbar" tone="accent">
								Tools, brush size, tile/voxel brush, stamps, undo, redo, import,
								and edit/preview mode.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-60">
								-&gt;
							</div>
							<WikiDiagramNode title="Right panel" tone="success">
								Read map info, inspect selections, choose colors/materials, show
								actors, and adjust preview lighting.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
				</div>
			),
		},
		{
			id: "map-size",
			title: "Map Size And Detail",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						The fields above the editor set the map's identity and shape. Change
						these early when possible, because changing the overall map size after
						detail work can make the map harder to reason about.
					</p>
					<WikiCardGrid
						items={[
							{
								title: "Width and length",
								tone: "primary",
								body:
									"Set how many tactical spaces the map covers from side to side and front to back.",
							},
							{
								title: "Max height",
								tone: "accent",
								body:
									"Sets how tall the editable space is. Use taller maps for towers, cliffs, deep pits, and flying encounters.",
							},
							{
								title: "Detail level",
								tone: "success",
								body:
									"Controls how fine the sculpting grid is. Higher detail is better for small features; lower detail is faster for broad layouts.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="Practical advice">
						<p>
							Start broad. Block out the playable space first, then increase detail
							only when you need smaller features. Most encounter maps do not need
							maximum detail everywhere.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "editor-navigation",
			title: "Navigation And Views",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						Use the mouse to move around the editor while building. The editor also
						has two views: <WikiHighlight tone="primary">Edit</WikiHighlight> for
						making changes, and <WikiHighlight tone="accent">Preview</WikiHighlight>{" "}
						for checking how the map feels in the full 3D battle view.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Left click",
								tone: "success",
								detail:
									"Paint, erase, sample, select, or place a stamp depending on the active tool.",
							},
							{
								name: "Middle drag",
								tone: "primary",
								detail:
									"Orbit or rotate the camera around the terrain.",
							},
							{
								name: "Right drag",
								tone: "secondary",
								detail:
									"Pan the camera across the terrain.",
							},
							{
								name: "Scroll",
								tone: "accent",
								detail:
									"Zoom in and out for detail work or a whole-map view.",
							},
							{
								name: "Edit view",
								tone: "warning",
								detail:
									"Shows the editing grid, hover previews, selections, and editor controls.",
							},
							{
								name: "Preview view",
								tone: "info",
								detail:
									"Shows the terrain in the gameplay map view so you can inspect lighting, scale, and readability.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Shortcut help">
						<p>
							The help button in the editor toolbar lists tool shortcuts, camera
							controls, stamp controls, and the mid-stroke Shift modifier.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "brush-tools",
			title: "Brush Tools",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						The main tool buttons control what happens when you click or drag on
						the map. The brush size slider changes the footprint of most brush
						actions.
					</p>
					<WikiCardGrid
						columns={2}
						items={[
							{
								title: "Tile brush",
								tone: "primary",
								body:
									"Best for laying out floors, walls, raised platforms, rooms, bridges, and obvious tactical spaces.",
							},
							{
								title: "Voxel brush",
								tone: "secondary",
								body:
									"Best for detailed sculpting, uneven stone, small ledges, rough terrain, rubble, and decorative shapes.",
							},
						]}
					/>
					<WikiFieldGrid
						items={[
							{
								name: "Place",
								tone: "success",
								detail:
									"Adds terrain where you paint. Use this to build floors upward, add walls, or place detail.",
							},
							{
								name: "Erase",
								tone: "error",
								detail:
									"Removes terrain. Use it to carve doors, pits, caves, broken walls, or negative space.",
							},
							{
								name: "Paint",
								tone: "accent",
								detail:
									"Changes the surface color or material without changing the shape.",
							},
							{
								name: "Sample",
								tone: "info",
								detail:
									"Picks up the color or material from the map so you can keep painting with it.",
							},
							{
								name: "Brush size",
								tone: "warning",
								detail:
									"Use small brushes for precise work and large brushes for fast blocking.",
							},
							{
								name: "Undo and redo",
								tone: "neutral",
								detail:
									"Step backward or forward after experiments, mistakes, or test strokes.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="Dragging across faces">
						<p>
							During a drag stroke, the editor tries to keep the stroke on a
							locked plane so brush work stays controlled. Hold Shift mid-stroke
							when you intentionally want to break across faces.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "right-toolbar",
			title: "Right Info Toolbar",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						The right toolbar changes depending on whether you are editing or
						previewing. In Edit view, it is where you check map counts, inspect
						selections, pick colors and materials, and show actor markers.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Info",
								tone: "primary",
								detail:
									"Shows the current terrain count so you can track map complexity while building.",
							},
							{
								name: "Selection",
								tone: "warning",
								detail:
									"Appears when a box or color selection is active. Use it to confirm how much is selected and adjust box bounds.",
							},
							{
								name: "Color",
								tone: "accent",
								detail:
									"Choose normal terrain colors from the palette.",
							},
							{
								name: "Materials",
								tone: "success",
								detail:
									"Choose special surface types such as water, lava, glass, metals, foliage, and other terrain materials.",
							},
							{
								name: "Actors",
								tone: "info",
								detail:
									"When editing the active map, toggle actor markers so you can avoid changing terrain blindly under the party.",
							},
							{
								name: "Preview settings",
								tone: "secondary",
								detail:
									"In Preview view, the toolbar switches to lighting and background controls.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "box-selection",
			title: "Box Selection",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						Box selection is for deliberate volume edits. Use it when you want a
						clean rectangular area instead of a freehand brush stroke.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Choose Box Select" tone="primary">
							Select the box selection tool from the top toolbar.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Click the first corner" tone="secondary">
							The first click places the anchor. The right toolbar shows the
							anchor while the selection is being formed.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Click the opposite corner" tone="accent">
							The second click completes the box. A selection preview appears on
							the map.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Check the right toolbar" tone="warning">
							Review the selected count and the min/max X, Y, and Z bounds. Adjust
							the numeric fields if you need exact edges.
						</WikiFlowStep>
						<WikiFlowStep number="5" title="Apply an edit" tone="success">
							Use Place, Erase, or Paint to fill, carve, or recolor the selected
							volume.
						</WikiFlowStep>
					</WikiFlow>
					<WikiCallout tone="info" title="Clearing a selection">
						<p>
							Click the active selection tool again to clear that selection. This
							is useful when you want to return to normal brush work.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "color-selection",
			title: "Color Selection",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						Color selection finds terrain that shares the selected color or
						material. It is best for map-wide recolors, replacing materials, or
						removing test shapes that were all painted the same way.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Choose Color Select" tone="primary">
							Select the color selection tool from the top toolbar.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Pick a color or material" tone="accent">
							Choose from the palette, choose a material, or click a surface on
							the map to target that surface type.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Inspect the selection" tone="warning">
							The right toolbar shows the selected count and the targeted color.
							Check this before applying a large edit.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Paint, erase, or replace" tone="success">
							Use Paint to recolor all selected terrain, or Erase if you really
							want to remove those matching pieces.
						</WikiFlowStep>
					</WikiFlow>
					<WikiCallout tone="warning" title="Large selection caution">
						<p>
							Color selection can affect many disconnected parts of the map at
							once. Always check the selected count in the right toolbar before
							editing.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "smoothing",
			title: "Smoothing",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						Smoothing is available when a box selection is active. It helps soften
						or blend rough selected surfaces after blocking out terrain.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Create a box selection" tone="primary">
							Select the area you want to smooth. Smoothing works on the selected
							volume, not the entire map.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Open the Selection panel" tone="secondary">
							The smoothing controls appear in the right toolbar under Selection
							after the box is complete.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Choose passes" tone="accent">
							More passes create a stronger smoothing effect. Start low, then add
							more if the result is still too harsh.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Press Smooth" tone="success">
							Apply the smoothing operation, inspect the result, and undo if it
							changes more than intended.
						</WikiFlowStep>
					</WikiFlow>
					<WikiCallout tone="info" title="Good smoothing uses">
						<p>
							Smoothing is best for cave floors, slopes, rubble piles, cliff
							edges, dunes, hills, and other organic terrain. For crisp dungeon
							rooms or constructed walls, leave edges sharp.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "colors-materials",
			title: "Colors And Materials",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						Use the Color and Materials panels to make the map readable. Colors
						are good for ordinary terrain, while materials are better for surfaces
						that should immediately communicate something special.
					</p>
					<WikiCardGrid
						items={[
							{
								title: "Readable floors",
								tone: "primary",
								body:
									"Keep important walking surfaces visually clear so players can understand where they can stand.",
							},
							{
								title: "Hazards",
								tone: "error",
								body:
									"Use obvious materials or colors for lava, pits, spike zones, deep water, acid, and other dangerous spaces.",
							},
							{
								title: "Atmosphere",
								tone: "accent",
								body:
									"Use material changes to sell locations: mossy stone, worn wood, metal bars, glowing light, ice, or ruined masonry.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="DM clarity">
						<p>
							Decorative detail is useful, but tactical clarity wins during play.
							If players are unsure whether a surface is walkable, simplify the
							shape or color it more clearly.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "editor-preview",
			title: "Preview Mode",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						Preview mode shows the terrain in the same style as the play map. Use
						it before saving or before a session to check whether the map reads
						well from the table view.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Lighting color",
								tone: "primary",
								detail:
									"Change the light's color to create sunlight, moonlight, firelight, magic, or strange underground tones.",
							},
							{
								name: "Intensity",
								tone: "warning",
								detail:
									"Raise or lower brightness so terrain details are visible without washing out the scene.",
							},
							{
								name: "Rotation",
								tone: "accent",
								detail:
									"Rotate where the light comes from, changing shadow direction and scene mood.",
							},
							{
								name: "Elevation",
								tone: "success",
								detail:
									"Move the light higher or lower in the sky. Low light creates stronger directional mood.",
							},
							{
								name: "Background",
								tone: "secondary",
								detail:
									"Enable and set a background color for caves, skies, voids, magical spaces, and encounter atmosphere.",
							},
							{
								name: "Return to Edit",
								tone: "info",
								detail:
									"Switch back to Edit when you need to continue sculpting or painting.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "stamps",
			title: "Stamps",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						Stamps are reusable terrain pieces. You can build a terrain once,
						mark it as a stamp, then insert that shape into other maps.
					</p>
					<WikiDiagram title="Stamp workflow">
						<div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Make a piece" tone="success">
								Create a terrain shaped like a staircase, tree, campfire, wall
								section, ruined pillar, trap, bridge, or room feature.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-60">
								-&gt;
							</div>
							<WikiDiagramNode title="Tag it" tone="primary">
								Put it in the stamps folder using the terrain tag path for stamps.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-60">
								-&gt;
							</div>
							<WikiDiagramNode title="Insert it" tone="accent">
								Open another map, choose the stamp, rotate or mirror it, and place
								it where needed.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiFlow>
						<WikiFlowStep number="1" title="Prepare stamp terrain" tone="primary">
							Build the object or feature as its own terrain. Keep it focused so
							it is easy to reuse.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Put it in the stamps folder" tone="secondary">
							Tag it so it appears in the Insert Stamp dropdown.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Choose Insert Stamp" tone="accent">
							Open your destination map and pick the stamp from the dropdown.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Rotate, mirror, and place" tone="success">
							Use R to rotate, M to mirror, left click to place, and Escape to
							stop stamping.
						</WikiFlowStep>
					</WikiFlow>
					<WikiCallout tone="info" title="Organization tip">
						<p>
							Make stamp folders by theme: ruins, forest, dungeon, furniture,
							traps, city, cave, and elemental hazards. Future you will find the
							right piece much faster.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "vox-import",
			title: "Importing VOX Files",
			level: 1,
			body: (
				<div className="space-y-4">
					<p>
						The editor can import a MagicaVoxel-style VOX file. Importing replaces
						the current terrain shape, so use it when you are starting from an
						external model or intentionally replacing the map.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Choose Import .vox" tone="primary">
							Use the import button in the editor toolbar and select a VOX file.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Choose world scale" tone="accent">
							If the file can fit at more than one detail level, choose the scale
							that best matches how large it should be at the table.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Confirm import" tone="success">
							The current terrain is replaced with the imported shape. If it is
							not right, use undo or cancel out before saving.
						</WikiFlowStep>
					</WikiFlow>
					<WikiCallout tone="warning" title="Import safety">
						<p>
							Importing is a replacement operation, not a stamp operation. Clone a
							map first if you want to preserve the current version.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "lighting",
			title: "Lighting During Play",
			body: (
				<div className="space-y-4">
					<p>
						During game time, the active terrain panel lets the DM change the
						current map's lighting and background. This is useful for time of day,
						magical effects, scene transitions, and mood changes.
					</p>
					<WikiCardGrid
						items={[
							{
								title: "Presets",
								tone: "success",
								body:
									"Use preset environments for fast changes like neutral, daytime, nighttime, or sunset.",
							},
							{
								title: "Custom light",
								tone: "primary",
								body:
									"Adjust light color, brightness, direction, and height when a scene needs a specific look.",
							},
							{
								title: "Background",
								tone: "secondary",
								body:
									"Change the background color to support caves, night skies, magical spaces, open daylight, or void-like scenes.",
							},
						]}
					/>
					<WikiFlow>
						<WikiFlowStep number="1" title="Open the active terrain panel" tone="primary">
							Use the terrain controls available while running the session.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Choose a preset or custom controls" tone="accent">
							Presets are quickest; custom controls are best for a precise mood.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Save useful looks" tone="success">
							If a lighting setup works well, save it as a preset for future maps.
						</WikiFlowStep>
					</WikiFlow>
				</div>
			),
		},
		{
			id: "active-map-editing",
			title: "Editing The Active Map",
			body: (
				<div className="space-y-4">
					<p>
						You can edit the terrain the table is currently using. That is useful
						when the environment changes mid-session: a bridge collapses, lava
						rises, a secret door opens, rubble appears, or a ritual changes the
						ground.
					</p>
					<WikiCallout tone="warning" title="Use care during live play">
						<p>
							If you reshape the active map under actors, their positions may need
							to be corrected. Keep live edits small and intentional unless you
							are deliberately changing the whole battlefield.
						</p>
					</WikiCallout>
					<WikiFieldGrid
						items={[
							{
								name: "Safe live edits",
								tone: "success",
								detail:
									"Painting surfaces, changing lighting, opening a passage, adding rubble, or making small terrain changes around the fight.",
							},
							{
								name: "Riskier live edits",
								tone: "warning",
								detail:
									"Changing map size, removing floors under actors, heavily reshaping occupied areas, or replacing major terrain features.",
							},
							{
								name: "Better prep option",
								tone: "primary",
								detail:
									"Clone the map before the session and prepare alternate versions for before/after encounter states.",
							},
							{
								name: "Deletion rule",
								tone: "error",
								detail:
									"You cannot delete the map currently being used. Switch to another terrain first.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "best-practices",
			title: "Best Practices",
			body: (
				<div className="space-y-4">
					<p>
						Good terrain is readable first and beautiful second. The best maps
						help players understand the encounter at a glance while still giving
						the scene character.
					</p>
					<WikiFieldGrid
						columns={1}
						items={[
							{
								name: "Block the playable space first",
								tone: "primary",
								detail:
									"Start with rooms, paths, elevation, cover, hazards, and objectives before adding decoration.",
							},
							{
								name: "Keep actor spaces clear",
								tone: "success",
								detail:
									"Make intended standing areas easy to see and large enough for the actors who should use them.",
							},
							{
								name: "Use clones for encounter phases",
								tone: "accent",
								detail:
									"Prepare versions like intact bridge, broken bridge, flooded chamber, burning inn, or opened vault.",
							},
							{
								name: "Make stamps from repeated shapes",
								tone: "info",
								detail:
									"If you build the same object twice, consider turning it into a stamp.",
							},
							{
								name: "Do not over-detail hidden areas",
								tone: "warning",
								detail:
									"Spend the detail budget where players will actually move, inspect, fight, or make decisions.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Developer reference">
						<p>
							Developer-facing terrain internals are documented separately in{" "}
							<WikiPageLink slug="terrains-and-voxels">
								Terrains & Voxels
							</WikiPageLink>
							. Rendering material details are in{" "}
							<WikiPageLink slug="materials">Materials</WikiPageLink>.
						</p>
					</WikiCallout>
				</div>
			),
		},
	],
	searchText:
		"terrain terrains map editor tile brush voxel brush place erase paint sample box selection color selection smoothing smooth passes right toolbar info selection panel color materials actors preview lighting background active map live editing clone tags folders stamps import vox worldbuilding dm guide",
};

export default terrainsPage;
