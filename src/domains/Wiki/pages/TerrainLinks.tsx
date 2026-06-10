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

export const terrainLinksPage: WikiPage = {
	slug: "terrain-links",
	title: "Terrain Links",
	audience: "DM Guide",
	category: "Worldbuilding",
	summary:
		"Connect one tile to another — across maps or within a single map — so the party can travel through doors, stairs, portals, and secret passages.",
	tags: ["terrain", "links", "doors", "travel", "portals", "map"],
	icon: "icon-[mdi--link-variant]",
	sections: [
		{
			id: "overview",
			title: "What Terrain Links Are",
			body: (
				<div className="space-y-4">
					<p>
						A terrain link is an invisible connection between two tiles. When an
						actor is standing on or next to one end, they can travel to the other
						end with a single click. The two ends can sit on{" "}
						<WikiHighlight tone="primary">different terrains</WikiHighlight> (a door
						that leads from the tavern map to the cellar map) or on the{" "}
						<WikiHighlight tone="accent">same terrain</WikiHighlight> (a magical
						portal that jumps across one big map).
					</p>
					<p>
						Links are how you stitch a campaign's maps into a connected world. A
						dungeon stops being a pile of separate rooms and becomes a place the
						party walks through: down the stairs, through the door, into the
						portal, out the cave mouth.
					</p>
					<WikiDiagram title="The terrain link workflow">
						<div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Link" tone="primary">
								Pick a tile on one map and a tile on another (or the same) map to
								connect the two ends.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Decorate" tone="success">
								Place a cosmetic stamp — a door, archway, trapdoor, or cave mouth —
								at each end so players can see where the link is.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Travel" tone="accent">
								During play, a player steps up to the link and clicks to cross to
								the other side.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiCallout tone="info" title="Links have no appearance of their own">
						<p>
							A link is pure mechanics — it has no model, no label, and no shape.
							Whatever the players see (a door, ladder, glowing rune) is a separate
							cosmetic stamp you place at the tile. The two are fully independent,
							so a link can even be buried under solid terrain to make a secret
							passage that is invisible until you reveal it.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "why-use",
			title: "Why Use Them",
			body: (
				<div className="space-y-4">
					<p>
						Terrain links let you keep encounters on separate, focused maps while
						still letting the party move between them naturally during a session.
					</p>
					<WikiCardGrid
						items={[
							{
								title: "Doors and stairs",
								tone: "primary",
								body:
									"Connect a building's entrance to its interior, or a stair landing to the floor above. The party walks through instead of you swapping maps for them.",
							},
							{
								title: "Secret passages",
								tone: "warning",
								body:
									"Bury a link under voxels or lock it until the trigger is found. Reveal it mid-session for hidden doors, sliding walls, and trapdoors.",
							},
							{
								title: "Portals and puzzles",
								tone: "accent",
								body:
									"Link two tiles on the same map for teleporters, pressure-plate puzzles, or one-room mazes that loop back on themselves.",
							},
							{
								title: "A connected world",
								tone: "success",
								body:
									"Wire a dungeon, town, or overland route together so the campaign feels like one continuous place rather than a stack of unrelated maps.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "how-they-work",
			title: "How Links Behave",
			body: (
				<div className="space-y-4">
					<p>
						A few rules govern every link. Knowing them up front makes placement
						and troubleshooting much easier.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Two-way",
								tone: "primary",
								detail:
									"A link works in both directions. You create one link and the party can travel either way through it — there is no need to make a separate return link.",
							},
							{
								name: "Step up, then cross",
								tone: "accent",
								detail:
									"An actor can use a link when standing on the link's tile or on any tile next to it. Simply walking onto the tile does not auto-travel; the player chooses to cross.",
							},
							{
								name: "One link per tile",
								tone: "warning",
								detail:
									"A tile can hold at most one link end. If you try to place a second link on a tile that already has one, the placement is rejected.",
							},
							{
								name: "Stored on the campaign",
								tone: "info",
								detail:
									"Because a link can join two different terrains, links live on the campaign as a whole rather than on a single map. Deleting a terrain automatically removes any links that touched it.",
							},
							{
								name: "DM-authored only",
								tone: "secondary",
								detail:
									"Only the DM can create, edit, lock, or delete links. Players can travel through them but never see the controls.",
							},
							{
								name: "Travel is a normal move",
								tone: "success",
								detail:
									"Crossing a link is treated as an ordinary move to the far tile, so it respects the usual movement and turn handling — it is not a free teleport that bypasses the rules.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "creating",
			title: "Creating A Link",
			body: (
				<div className="space-y-4">
					<p>
						Links are placed in the terrain editor. Open the map that should hold
						the first end of the link, then use the link tool in the editor
						toolbar.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Save the terrain first" tone="warning">
							The link tool is disabled until the terrain has been saved. A link
							points at a specific saved map, so save your map before linking.
							The tooltip reminds you if the button is still locked.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Choose the link tool" tone="primary">
							Click the link (chain) button in the editor toolbar, or press{" "}
							<WikiHighlight tone="primary">K</WikiHighlight>. While the tool is
							active, the toolbar shows an "ESC to stop" reminder.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Click the first tile" tone="secondary">
							Click a tile on the current map to place the first end. This tile
							must be empty of any other link end.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Pick the destination map" tone="accent">
							A picker appears. Choose which terrain the other end lives on. Pick
							the same terrain for an in-map portal, or a different terrain for a
							door between maps.
						</WikiFlowStep>
						<WikiFlowStep number="5" title="Click the second tile" tone="success">
							The destination map appears so you can click the far tile. Once both
							ends are set, the link is created and ready to use.
						</WikiFlowStep>
					</WikiFlow>
					<WikiCallout tone="info" title="Press Escape to stop">
						<p>
							The link tool stays active so you can place several links in a row.
							Press <WikiHighlight tone="neutral">Escape</WikiHighlight> (or click
							the toolbar warning) when you are finished placing links.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "decorating",
			title: "Decorating A Link",
			body: (
				<div className="space-y-4">
					<p>
						A bare link is invisible during normal play, so players will not know
						it is there. Mark each end with a cosmetic stamp or sculpted feature so
						the link reads as a real piece of the world.
					</p>
					<WikiCardGrid
						items={[
							{
								title: "Doorways and arches",
								tone: "primary",
								body:
									"Place a door frame or arch stamp on the link tile so the party recognizes an exit and walks toward it.",
							},
							{
								title: "Stairs and ladders",
								tone: "accent",
								body:
									"A staircase or ladder feature sells a link that climbs between floors or levels of a dungeon.",
							},
							{
								title: "Portals and runes",
								tone: "secondary",
								body:
									"Glowing materials, a rune circle, or a swirling frame make a same-map teleport link obvious.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="Decoration is optional and independent">
						<p>
							The stamp and the link are not connected to each other. You can leave
							a link undecorated for a hidden passage, hide it under solid terrain,
							or change the decoration any time without touching the link. See{" "}
							<WikiPageLink slug="terrains">Terrains</WikiPageLink> for how stamps
							work.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "managing",
			title: "Managing Links In The Editor",
			body: (
				<div className="space-y-4">
					<p>
						The editor's right-side panel has a <WikiHighlight tone="primary">Links</WikiHighlight>{" "}
						section listing every link that touches the current map, with a count
						of how many there are.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Show on map",
								tone: "info",
								detail:
									"Toggle to display the otherwise-invisible link ends right in the editor canvas so you can see exactly where they sit.",
							},
							{
								name: "Select a link",
								tone: "primary",
								detail:
									"Click an entry in the list to highlight that link on the map. Each entry shows the name of the terrain it leads to.",
							},
							{
								name: "Lock / unlock",
								tone: "warning",
								detail:
									"The lock button toggles whether the link can currently be used. Locked links are hidden from players until you unlock them.",
							},
							{
								name: "Delete",
								tone: "error",
								detail:
									"The trash button removes the link entirely. Both ends disappear at once, since a link is a single two-way connection.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "locking",
			title: "Locking Links",
			body: (
				<div className="space-y-4">
					<p>
						Every link has a lock state. A locked link is completely hidden and
						unusable for anyone controlling an actor — there is no hover hint, no
						prompt, and no way to travel through it. This is your switch for
						doors that are barred, passages not yet discovered, or portals that
						only activate once a condition is met.
					</p>
					<WikiCallout tone="info" title="Only the DM sees locked links">
						<p>
							When the DM turns on link display (in the editor's "Show on map"
							toggle, or the map's terrain-link toggle during play), locked links
							appear in a distinct color so the DM can find and unlock them.
							Players — and the DM while impersonating a player — see nothing until
							the link is unlocked.
						</p>
					</WikiCallout>
					<WikiFieldGrid
						items={[
							{
								name: "Locked",
								tone: "error",
								detail:
									"Invisible and inert to players. Use for secret, barred, or not-yet-active passages. Toggle from the editor link list or from the play map.",
							},
							{
								name: "Unlocked",
								tone: "success",
								detail:
									"Live and usable. A nearby actor sees a travel prompt and can cross. This is the default state for a new link.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "traveling",
			title: "Traveling Through A Link",
			body: (
				<div className="space-y-4">
					<p>
						During a session, any player whose actor is on or next to an unlocked
						link end can cross it. How they do that depends on which view they are
						using.
					</p>
					<WikiCardGrid
						columns={2}
						items={[
							{
								title: "World (table) view",
								tone: "primary",
								body:
									"Hovering near the link shows a tooltip naming the terrain it leads to (\"To Cellar\"). Click the link to travel.",
							},
							{
								title: "First-person view",
								tone: "accent",
								body:
									"When the actor is at the link, a prompt appears: press E to travel to the named destination.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Crossing moves the actor">
						<p>
							Using a link moves the controlled actor to the tile at the far end —
							onto the destination map if the two ends are on different terrains.
							Each player sees the map their own selected character is on, so a
							split party can be spread across several maps at once.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "dm-display",
			title: "Seeing Links During Play",
			body: (
				<div className="space-y-4">
					<p>
						The DM has a terrain-link toggle on the map toolbar during a live
						session. Turning it on overlays every link end on the current map —
						including locked ones — color-coded by state, so you can keep track of
						where your doors and passages are and unlock them at the right dramatic
						moment.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Toggle link display" tone="primary">
							Use the terrain-link button on the DM map toolbar to show or hide the
							link overlay.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Find the link to change" tone="accent">
							Hover a link end. The tooltip names where it leads and, in this
							authoring mode, offers a click to lock or unlock it.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Reveal on cue" tone="success">
							Unlock a hidden passage the instant the party finds it, and the
							travel prompt becomes available to them immediately.
						</WikiFlowStep>
					</WikiFlow>
				</div>
			),
		},
		{
			id: "best-practices",
			title: "Best Practices",
			body: (
				<div className="space-y-4">
					<WikiFieldGrid
						columns={1}
						items={[
							{
								name: "Always decorate live links",
								tone: "primary",
								detail:
									"If players are meant to find a link, give it a visible marker. An undecorated link is only useful when you want it hidden.",
							},
							{
								name: "Lock anything not yet discovered",
								tone: "warning",
								detail:
									"Keep secret doors and inactive portals locked so players cannot stumble onto the travel prompt before the reveal.",
							},
							{
								name: "Name your terrains clearly",
								tone: "info",
								detail:
									"Travel prompts show the destination terrain's name (\"To Cellar\"), so clear map names make the world easier for players to read.",
							},
							{
								name: "Save before you link",
								tone: "secondary",
								detail:
									"The link tool needs a saved terrain. Build and save the map, then add links as a finishing pass.",
							},
							{
								name: "Place links at natural exits",
								tone: "success",
								detail:
									"Put link ends where players expect to leave — doorways, stair landings, edges, and cave mouths — so travel feels intuitive.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Related reading">
						<p>
							Terrain links build on the map system covered in{" "}
							<WikiPageLink slug="terrains">Terrains</WikiPageLink>. For how the
							underlying voxel maps are stored, see{" "}
							<WikiPageLink slug="terrains-and-voxels">
								Terrains &amp; Voxels
							</WikiPageLink>
							.
						</p>
					</WikiCallout>
				</div>
			),
		},
	],
	searchText:
		"terrain link links door doors stair stairs portal portals secret passage trapdoor cave mouth travel cross connect maps tiles anchor locked lock unlock invisible undirected two-way same terrain across terrains first person E to travel world view click move worldbuilding dm guide",
};

export default terrainLinksPage;
