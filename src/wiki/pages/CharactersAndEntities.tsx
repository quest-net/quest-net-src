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
import type { WikiPageDefinition } from "./WikiPage";

const charactersAndEntitiesPage: WikiPageDefinition = {
	slug: "characters-and-entities",
	title: "Characters & Entities",
	audience: "DM Guide",
	category: "Run The Game",
	summary:
		"How actors work in Quest-Net — the difference between characters and entities, how to create and spawn them, and every field on the actor sheet.",
	tags: [
		"character",
		"entity",
		"actor",
		"roster",
		"spawn",
		"stats",
		"actions",
		"attributes",
		"inventory",
		"skills",
		"statuses",
		"size",
		"movement",
	],
	icon: "icon-[mdi--account-group]",
	order: 5,
	sections: [
		{
			id: "characters-vs-entities",
			title: "Characters vs. Entities",
			order: 0,
			body: (
				<div className="space-y-4">
					<p>
						Quest-Net has two kinds of actors on the map:{" "}
						<WikiHighlight tone="primary">Characters</WikiHighlight> (the party)
						and <WikiHighlight tone="secondary">Entities</WikiHighlight> (NPCs,
						enemies, and anything else). They share the same underlying data
						structure but behave differently when spawned and removed.
					</p>
					<WikiCardGrid
						columns={2}
						items={[
							{
								title: "Characters",
								tone: "primary",
								body: "Persistent actors owned by players. A character exists in exactly one place at a time: either in the Roster (off the map) or on the active field. Spawning moves them; removing moves them back. Nothing is duplicated — all edits persist across sessions.",
							},
							{
								title: "Entities",
								tone: "secondary",
								body: "Template-based actors managed by the DM. The template stays in the catalog; each spawn creates an independent clone with a new ID. You can have multiple instances of the same entity on the field at once. Removing an instance deletes it — it does not return to the catalog.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Item entities">
						<p>
							Dropped items become a special kind of entity on the map. They look
							like actors but carry a serialized item snapshot in their tags.
							The initiative and combat systems automatically exclude them from
							action queues.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "roster-and-templates",
			title: "Roster & Template Catalog",
			order: 1,
			body: (
				<div className="space-y-4">
					<p>
						Before anything is on the map, actors live in holding areas. Open the{" "}
						<WikiHighlight tone="neutral">Characters</WikiHighlight> or{" "}
						<WikiHighlight tone="neutral">Entities</WikiHighlight> tabs from the
						campaign sidebar to manage them.
					</p>
					<WikiFieldGrid
						columns={2}
						items={[
							{
								name: "Character Roster",
								tone: "primary",
								detail:
									"All characters created for the campaign. Characters here are off the map. The DM can spawn any of them; players are automatically prompted to pick one when they join.",
							},
							{
								name: "Entity Templates",
								tone: "secondary",
								detail:
									"The DM's catalog of reusable NPC and enemy blueprints. Templates are never placed directly — each spawn creates a fresh clone with a new ID and independent state.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="Deleting vs. removing">
						<p>
							A character cannot be deleted from the roster while they are on the
							field. Remove them first, then delete. Deleting an entity template
							does not affect instances already on the field; those instances
							are independent clones.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "spawning",
			title: "Spawning & Removing",
			order: 2,
			body: (
				<div className="space-y-4">
					<p>
						Spawning places an actor on the active map. The app tries to find a
						sensible starting position using the terrain's spawn point; if no
						terrain is loaded it defaults to the origin.
					</p>
					<WikiDiagram title="Character lifecycle">
						<div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Roster" tone="primary">
								Character is off the map. Edits here persist normally.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								&#8644;
							</div>
							<WikiDiagramNode title="Field" tone="success">
								Character is on the map inside GameState. All stats, position,
								and status changes are live.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								&#8644;
							</div>
							<WikiDiagramNode title="Roster (returned)" tone="primary">
								Removing sends them back to the roster with all changes intact.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiDiagram title="Entity lifecycle">
						<div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Template catalog" tone="secondary">
								Template stays here permanently.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								&#8594;
							</div>
							<WikiDiagramNode title="Clone on field" tone="success">
								A new instance with a new ID. State is independent of the
								template and of other instances.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								&#8594;
							</div>
							<WikiDiagramNode title="Deleted" tone="error">
								Removing an entity instance deletes it. It does not go back to
								the template catalog.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiCallout tone="success" title="Entity auto-naming">
						<p>
							When more than one instance of the same template is on the field,
							Quest-Net automatically adds letter suffixes: the first instance
							keeps the base name, the second becomes{" "}
							<WikiHighlight tone="neutral">Goblin [A]</WikiHighlight>, the
							third <WikiHighlight tone="neutral">Goblin [B]</WikiHighlight>,
							and so on, up to 26 per template.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "core-fields",
			title: "Core Actor Fields",
			order: 3,
			body: (
				<div className="space-y-4">
					<p>
						Every actor — character or entity — shares the same set of fields on
						their edit form.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Name",
								tone: "primary",
								detail:
									"Displayed on the map standee, party panel, initiative order, and log entries.",
							},
							{
								name: "Description",
								tone: "neutral",
								detail:
									"Freeform text visible on the actor sheet. Good for flavor, backstory, or DM notes on an enemy.",
							},
							{
								name: "Image",
								tone: "secondary",
								detail:
									"Portrait used on the standee and character sheet. Images are stored in IndexedDB and synced to players over the peer network.",
							},
							{
								name: "Color",
								tone: "accent",
								detail:
									"The accent color shown on the map standee border and stat bars. Characters default to blue; entities to amber.",
							},
							{
								name: "Move Speed",
								tone: "success",
								detail:
									"Tactical movement budget per turn. Used by the movement range overlay and Dijkstra pathfinding. Can also be selected as an initiative source.",
							},
							{
								name: "Can Fly",
								tone: "info",
								detail:
									"Enables vertical movement over terrain gaps. Flying actors can occupy airspace above the terrain surface. The movement cost formula from Campaign Settings can optionally exempt flying actors from height costs.",
							},
							{
								name: "Size",
								tone: "warning",
								detail:
									"Controls the actor's footprint on the map. Options are extra-small, small, medium, and large.",
							},
							{
								name: "Tags",
								tone: "neutral",
								detail:
									"Arbitrary labels. Used to organize actors in the roster/catalog via folder paths (e.g., npc/town) and for filtering.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "stats",
			title: "Stats",
			order: 4,
			body: (
				<div className="space-y-4">
					<p>
						Stats are numeric resources like HP, MP, or Stamina. Each actor has a
						list of <WikiCode>StatSlots</WikiCode> — one per stat type defined in{" "}
						<WikiPageLink slug="campaign-settings">Campaign Settings</WikiPageLink>.
						The slot holds the per-actor instance values; the definition holds the
						campaign-wide defaults.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Current",
								tone: "primary",
								detail: (
									<>
										The actor's current value for this stat. A value of{" "}
										<WikiCode>null</WikiCode> means the actor does not have this
										stat — it is hidden from their sheet, skipped by regen and
										restore, and excluded from transfers. A stat can be
										"unset" without losing its Max.
									</>
								),
							},
							{
								name: "Max",
								tone: "secondary",
								detail:
									"The actor's maximum value for this stat. Can differ from the campaign default. Current is clamped to Max on save.",
							},
							{
								name: "Regen Rate (override)",
								tone: "accent",
								detail:
									"Optional per-actor override. If set, this replaces the campaign definition's RegenRate for this actor only. Setting it to 0 disables regen for this actor even if the template has a positive rate.",
							},
							{
								name: "Restore Rule (override)",
								tone: "success",
								detail:
									"Optional per-actor override for how this stat is restored on short rest, long rest, or combat end.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Slot vs. definition precedence">
						<p>
							For regen and restore rules: if the slot has a value, that value
							wins. If the slot field is <WikiCode>undefined</WikiCode>, the
							campaign definition is used.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "actions",
			title: "Actions",
			order: 5,
			body: (
				<div className="space-y-4">
					<p>
						Actions are per-turn resources like Action, Bonus Action, or Reaction.
						Each actor has an <WikiCode>ActionSlot</WikiCode> for each action type
						defined in Campaign Settings.
					</p>
					<WikiFieldGrid
						columns={2}
						items={[
							{
								name: "Max",
								tone: "primary",
								detail:
									"How many of this action the actor can take per turn. Can differ from the campaign template default.",
							},
							{
								name: "Current",
								tone: "secondary",
								detail:
									"Remaining uses this turn. Automatically reset to Max every time a combat round advances (including on rewind).",
							},
						]}
					/>
					<WikiCallout tone="success" title="Spending actions">
						<p>
							Players can spend action uses directly from the Party panel by
							clicking the action bubbles next to their character. The DM can
							adjust any actor's current actions from the Inspector panel or
							entity action bar.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "attributes",
			title: "Attributes",
			order: 6,
			body: (
				<div className="space-y-4">
					<p>
						Attributes are freeform text fields — Class, Level, Race, Alignment,
						and anything else your system tracks as a label rather than a number.
						Each actor automatically receives a slot for every attribute type
						defined in Campaign Settings. Slots with no value are hidden from the
						character sheet.
					</p>
					<WikiCallout tone="success" title="Initiative from attributes">
						<p>
							Attribute values are parsed as numbers when used as an initiative
							source. If you ask players to roll initiative and record the result
							in an attribute like "Initiative Roll", you can then select that
							attribute as the initiative source in{" "}
							<WikiPageLink slug="campaign-settings">
								Campaign Settings
							</WikiPageLink>
							.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "inventory-equipment-skills",
			title: "Inventory, Equipment & Skills",
			order: 7,
			body: (
				<div className="space-y-4">
					<p>
						Items and skills are defined at the campaign level as templates. Actors
						hold slot references to those templates, along with any instance-level
						state (uses remaining).
					</p>
					<WikiCardGrid
						columns={3}
						items={[
							{
								title: "Inventory",
								tone: "primary",
								body: "Items carried but not equipped. Each slot references an Item template by ID and tracks UsesLeft independently.",
							},
							{
								title: "Equipment",
								tone: "secondary",
								body: "Items currently equipped. Mechanically identical to inventory slots — the distinction is visual and organizational. Items marked IsEquippable can appear here.",
							},
							{
								title: "Skills",
								tone: "accent",
								body: "Abilities or special moves the actor knows. Skill slots reference Skill templates and also track UsesLeft per actor.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Template reference">
						<p>
							Items and skills are looked up from the campaign's template lists
							at runtime. Deleting a template does not remove existing slots from
							actors, but those slots will no longer resolve to a template and
							will appear as missing in the UI.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "statuses",
			title: "Statuses",
			order: 8,
			body: (
				<div className="space-y-4">
					<p>
						Statuses are active effects applied to an actor. Each status slot
						references a Status template and tracks its own expiration state
						independently.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Permanent",
								tone: "neutral",
								detail:
									"Never expires automatically. Must be removed manually. Survives combat end, rests, and calendar changes.",
							},
							{
								name: "Turns",
								tone: "warning",
								detail:
									"Has a turnsLeft counter. Decremented by 1 each time a combat round advances. Removed automatically when turnsLeft reaches 0. Cleared entirely when combat ends.",
							},
							{
								name: "Short Rest",
								tone: "info",
								detail:
									"Removed when a short rest (or long rest) is taken.",
							},
							{
								name: "Long Rest",
								tone: "success",
								detail:
									"Removed when a long rest is taken.",
							},
							{
								name: "Days",
								tone: "accent",
								detail:
									"Has a daysLeft counter. Decremented on long rest and when the calendar advances. Removed when daysLeft reaches 0.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="Combat end clears turn-based statuses">
						<p>
							When combat ends, all statuses with expiration type{" "}
							<WikiHighlight tone="warning">turns</WikiHighlight> are removed
							from every actor automatically. All other expiration types survive.
							See <WikiPageLink slug="combat">Running Combat</WikiPageLink> for
							the full end-of-combat cleanup list.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "position",
			title: "Position & Movement",
			order: 9,
			body: (
				<div className="space-y-4">
					<p>
						Each actor has a{" "}
						<WikiCode>Position</WikiCode> with three coordinates.
					</p>
					<WikiFieldGrid
						columns={2}
						items={[
							{
								name: "x / y",
								tone: "primary",
								detail:
									"Horizontal position in tactical units. Integer values correspond to map tiles.",
							},
							{
								name: "h",
								tone: "secondary",
								detail:
									"Height in tactical units. Corresponds to the terrain surface height the actor is standing on (or flying at).",
							},
						]}
					/>
					<p>
						During combat, each actor also has a{" "}
						<WikiCode>TurnStartPosition</WikiCode> — a snapshot of where they were
						at the start of their turn. The map uses this to display remaining
						movement range rather than the full budget. It is set when combat
						starts and refreshed whenever the acting side changes. It is removed
						when combat ends.
					</p>
					<WikiCallout tone="info" title="Movement reference">
						<p>
							For how movement range is computed, height costs, and flying rules,
							see{" "}
							<WikiPageLink slug="terrains-and-voxels">
								Terrains &amp; Voxels
							</WikiPageLink>
							. For restricting player movement to their calculated range, see{" "}
							<WikiPageLink slug="campaign-settings">
								Campaign Settings
							</WikiPageLink>
							.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "character-only",
			title: "Character-Only Fields",
			order: 10,
			body: (
				<div className="space-y-4">
					<p>
						Characters have two fields that entities do not.
					</p>
					<WikiFieldGrid
						columns={2}
						items={[
							{
								name: "Notes",
								tone: "primary",
								detail:
									"Private notes attached to the character. Visible only to the character's owner and the DM. Useful for backstory, quest hooks, and session reminders.",
							},
							{
								name: "Crit Message",
								tone: "accent",
								detail:
									"Optional text shown when this character rolls a critical hit. Leave blank for no special message.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "item-entities",
			title: "Item Entities (Dropped Items)",
			order: 11,
			body: (
				<div className="space-y-4">
					<p>
						When a character or entity drops an item, it becomes a special entity
						on the map. Item entities are technically entities — they have a
						position and appear on the map — but they carry a full item snapshot
						serialized into their tags rather than live stats.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Item dropped" tone="primary">
							An item is removed from an actor's inventory or equipment and a
							new entity is created at that actor's position. The entity's tag
							contains a snapshot of the item's state at drop time (name, uses
							left, costs, etc.).
						</WikiFlowStep>
						<WikiFlowStep number="2" title="On the map" tone="secondary">
							The dropped item appears as a small standee on the 3D map. Its
							color defaults to near-white to distinguish it from active actors.
							It has no HP, no movement, and no actions.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Picked up" tone="success">
							Another actor moves onto the tile and picks up the item. The entity
							is removed from the map and the item snapshot is deserialized and
							added to the picking actor's inventory.
						</WikiFlowStep>
					</WikiFlow>
					<WikiCallout tone="info" title="Excluded from combat">
						<p>
							Item entities are automatically excluded from initiative order,
							turn tracking, and the "active actor" banner. The combat system
							detects them by checking for the <WikiCode>item:</WikiCode> tag
							prefix on the entity's tags.
						</p>
					</WikiCallout>
				</div>
			),
		},
	],
	searchText:
		"character entity actor roster template spawn remove field lifecycle stats actions attributes inventory equipment skills statuses position size move speed fly crit message notes item entity drop pickup StatSlot ActionSlot AttributeSlot StatusSlot TurnStartPosition CharacterRoster EntityTemplates GameState",
};

export default charactersAndEntitiesPage;
