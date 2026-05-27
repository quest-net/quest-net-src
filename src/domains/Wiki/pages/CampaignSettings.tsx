import {
	WikiCallout,
	WikiCardGrid,
	WikiCode,
	WikiFieldGrid,
	WikiHighlight,
	WikiPageLink,
} from "../components/content";
import type { WikiPageDefinition } from "./WikiPage";

const campaignSettingsPage: WikiPageDefinition = {
	slug: "campaign-settings",
	title: "Campaign Settings",
	audience: "DM Guide",
	category: "Run The Game",
	summary:
		"A reference for every setting in the Campaign Settings screen — stats, actions, attributes, visibility, calendar, rests, movement, initiative, and terrain environments.",
	tags: [
		"settings",
		"stats",
		"actions",
		"attributes",
		"initiative",
		"movement",
		"rest",
		"calendar",
		"visibility",
		"shared inventory",
		"terrain",
	],
	icon: "icon-[mdi--cog]",
	order: 20,
	sections: [
		{
			id: "overview",
			title: "Where to Find Settings",
			order: 0,
			body: (
				<div className="space-y-4">
					<p>
						Open the campaign, then navigate to{" "}
						<WikiHighlight tone="neutral">Settings</WikiHighlight> from the
						sidebar. All settings on this screen are shared across the entire
						campaign — they apply to all characters, entities, and sessions. Only
						the DM can save changes.
					</p>
					<WikiCallout tone="info" title="Initiative settings shortcut">
						<p>
							Initiative settings can also be changed from a gear icon inside the
							Combat panel. Changes made there are identical to changes made here
							and save to the same place. See{" "}
							<WikiPageLink slug="combat">Running Combat</WikiPageLink> for how
							initiative is used during a session.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "stat-definitions",
			title: "Stat Definitions",
			order: 1,
			body: (
				<div className="space-y-4">
					<p>
						Stats are numeric resources tracked on every actor — hit points, mana,
						stamina, and so on. You define the campaign's stat types here; actors
						store individual slots that reference these definitions by ID. Removing
						a definition does not delete values already stored on actors, but those
						values become unreferenced and will no longer display.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Name",
								tone: "primary",
								detail:
									"The label shown on character sheets and in the log (e.g., HP, MP, Stamina).",
							},
							{
								name: "Color",
								tone: "secondary",
								detail:
									"The color used for this stat's bar and badges across the UI.",
							},
							{
								name: "Max",
								tone: "accent",
								detail:
									"The default maximum value for new actors. Individual actors can override this in their own stat slot.",
							},
							{
								name: "Regen Rate",
								tone: "success",
								detail:
									"Amount restored per round when combat advances. 0 means no regen. Individual actors can override this. See the regen section of Running Combat for when regen fires.",
							},
							{
								name: "Restore Rule",
								tone: "info",
								detail:
									'How the stat is restored on short rest, long rest, or combat end. Options: restore by a fixed amount, restore to max, or set to an exact value. Leave empty for no automatic restoration.',
							},
							{
								name: "Overflow Target",
								tone: "warning",
								detail:
									"Optional. If a character's regen would push this stat past Max, the surplus is added to the specified shared inventory pool stat instead of being discarded.",
							},
						]}
					/>
					<WikiCallout tone="success" title="Per-actor overrides">
						<p>
							Max, RegenRate, and OverflowTarget on a stat definition are
							defaults. An actor's stat slot can override any of them — useful for
							characters with higher HP or custom regen rates. The slot value
							always wins over the definition default.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "action-definitions",
			title: "Action Definitions",
			order: 2,
			body: (
				<div className="space-y-4">
					<p>
						Actions are limited-use per-turn resources — standard action, bonus
						action, reaction, and so on. Like stats, they are defined here and
						referenced by actors via slots.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Name",
								tone: "primary",
								detail: 'The label shown in the actor panel (e.g., "Action", "Bonus Action", "Reaction").',
							},
							{
								name: "Color",
								tone: "secondary",
								detail: "Badge color used for this action type in the UI.",
							},
							{
								name: "Max",
								tone: "accent",
								detail:
									"Default number of uses per turn for new actors. Automatically refilled when the round advances.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Reset on round advance">
						<p>
							All action counts are reset to Max every time a round advances —
							including when rewinding. There is no separate rest-based restoration
							for actions; they always refill at the round boundary.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "attribute-definitions",
			title: "Attribute Definitions",
			order: 3,
			body: (
				<div className="space-y-4">
					<p>
						Attributes are freeform text fields that appear on every character
						sheet. Use them for class, level, alignment, background, race, or any
						other non-numeric information about a character. Attributes only appear
						on the character sheet if the actor has a value set for them.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Name",
								tone: "primary",
								detail: 'The label shown on the character sheet (e.g., "Class", "Level", "Race").',
							},
						]}
					/>
					<WikiCallout tone="success" title="Used for initiative">
						<p>
							Attribute values can be used as initiative sources. If you want
							players to roll for initiative and record the result as an attribute
							(e.g., "Initiative"), define the attribute here and then select it
							as a source in Initiative Settings.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "shared-inventories",
			title: "Shared Inventories",
			order: 4,
			body: (
				<div className="space-y-4">
					<p>
						Shared inventories are party-wide resource pools that multiple actors
						can draw from or contribute to. Common uses include a party supply of
						healing items, a group mana pool, or an ammunition stockpile.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Name",
								tone: "primary",
								detail: 'A label for the pool (e.g., "Party Medkit", "Group SP", "Ammo").',
							},
							{
								name: "Stats",
								tone: "secondary",
								detail:
									"Numeric stats tracked on the pool. These reference the campaign's Stat Definitions by ID and can have their own Max and RegenRate overrides.",
							},
							{
								name: "Inventory",
								tone: "accent",
								detail:
									"Item slots shared by the whole party. Characters can interact with these items from their own sheets.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="Overflow target">
						<p>
							A stat definition can send excess regen into a shared inventory
							stat. For example, if a character's HP regen exceeds their Max,
							the surplus can flow into a party healing pool instead of being
							wasted. Configure this via{" "}
							<WikiHighlight tone="warning">Overflow Target</WikiHighlight> on
							the stat definition.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "visibility-settings",
			title: "Visibility Settings",
			order: 5,
			body: (
				<div className="space-y-4">
					<p>
						These toggles control what players can see in the shared session.
						They apply to all connected players in the campaign.
					</p>
					<WikiCardGrid
						columns={3}
						items={[
							{
								title: "Players see DM rolls",
								tone: "primary",
								body: "When on, dice rolls made by the DM appear in the shared log visible to players.",
							},
							{
								title: "Players see peer rolls",
								tone: "secondary",
								body: "When on, dice rolls made by other players appear in each player's log.",
							},
							{
								title: "Players see entity HP",
								tone: "accent",
								body: "When on, players can see the current and maximum health of enemies and other entities on the map.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "calendar-settings",
			title: "Calendar Settings",
			order: 6,
			body: (
				<div className="space-y-4">
					<p>
						Quest-Net includes an in-world calendar for tracking the passage of
						time in your campaign. Every field here is optional — leave counts at
						0 or labels blank to hide concepts your world doesn't use.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Days per week / Days per month / Months per year",
								tone: "primary",
								detail:
									"The structural lengths of your calendar. Set daysPerWeek to 0 to remove the week concept entirely.",
							},
							{
								name: "Day names / Month names",
								tone: "secondary",
								detail:
									"Custom names for days of the week and months of the year. Arrays should match the corresponding count.",
							},
							{
								name: "Week / Month / Year labels",
								tone: "accent",
								detail:
									'Human labels for calendar units. Use "tenday" instead of "week", or "Solar Cycle" instead of "year". Leave blank to hide the concept from the UI.',
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "rest-settings",
			title: "Rest Settings",
			order: 7,
			body: (
				<div className="space-y-4">
					<p>
						Rests let you restore character stats between encounters without
						running a full long rest. These settings control how rests behave
						at the campaign level.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Short rests per day",
								tone: "primary",
								detail:
									"How many short rests the party can take before a long rest resets the count. Set to 0 for unlimited short rests.",
							},
							{
								name: "Long rest increments calendar",
								tone: "secondary",
								detail:
									"When enabled, taking a long rest automatically advances the in-world calendar by one day.",
							},
						]}
					/>
					<WikiCallout tone="info" title="What rests restore">
						<p>
							What each rest type restores is configured per-stat, not here.
							Open{" "}
							<WikiHighlight tone="neutral">Stat Definitions</WikiHighlight> and
							set the <WikiHighlight tone="info">Restore Rule</WikiHighlight> on
							each stat to control short rest, long rest, and combat-end behavior
							independently.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "initiative-settings",
			title: "Initiative Order",
			order: 8,
			body: (
				<div className="space-y-4">
					<p>
						This section configures how combat turn order is determined. The same
						settings are accessible from the gear icon in the Combat panel during
						a session.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Mode",
								tone: "primary",
								detail:
									'Party mode: party and enemies alternate sides each round. Individual mode: every actor shares one round, sorted against each other. Mode cannot be changed once combat is active.',
							},
							{
								name: "Sources",
								tone: "secondary",
								detail:
									"An ordered chain of sort keys. The first source is the primary sort; later sources break ties. Each source can be a stat (by ID), an attribute (by ID), or Move Speed. All sources sort greatest-first.",
							},
						]}
					/>
					<WikiCallout tone="success" title="Full combat reference">
						<p>
							For a complete walkthrough of how initiative is used during a
							session — starting combat, advancing rounds, marking turns done —
							see <WikiPageLink slug="combat">Running Combat</WikiPageLink>.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "terrain-environments",
			title: "Terrain Environments",
			order: 9,
			body: (
				<div className="space-y-4">
					<p>
						Terrain environment presets are saved lighting and sky configurations
						that can be applied to any voxel terrain. Define them here; apply them
						from inside the terrain editor.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Lighting",
								tone: "primary",
								detail:
									"Color, intensity, rotation (horizontal angle), and elevation (vertical angle) of the main directional light.",
							},
							{
								name: "Background",
								tone: "secondary",
								detail:
									"Color used for the scene background / sky behind the terrain.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Saving presets">
						<p>
							Presets are saved from within the terrain editor's environment
							controls — not from this settings screen. This screen only lets you
							review and delete existing presets. See{" "}
							<WikiPageLink slug="terrains-and-voxels">
								Terrains &amp; Voxels
							</WikiPageLink>{" "}
							for the full terrain editing reference.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "movement-settings",
			title: "Movement & Height",
			order: 10,
			body: (
				<div className="space-y-4">
					<p>
						These settings control how vertical terrain height translates into
						extra movement cost on the 3D map. They apply to all actors unless
						flying rules override them.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Height cost formula",
								tone: "primary",
								detail: (
									<>
										A math expression using{" "}
										<WikiCode>h</WikiCode> as the absolute height difference
										between adjacent surfaces. Common examples:{" "}
										<WikiCode>floor(h/2)</WikiCode> (D&amp;D 5e style),{" "}
										<WikiCode>h</WikiCode> (1 cost per unit),{" "}
										<WikiCode>0</WikiCode> (height is free). The formula is
										pre-computed into a lookup table when saved.
									</>
								),
							},
							{
								name: "Flying ignores height",
								tone: "secondary",
								detail:
									"When on, actors with the Can Fly flag pay no extra cost for vertical movement — they only pay the horizontal distance cost.",
							},
							{
								name: "Restrict player movement to range",
								tone: "accent",
								detail:
									"When on, players can only move their actor within the highlighted range shown on the map. Outside combat this is the full movement budget; during combat it is the remaining budget for the turn. DMs are never restricted.",
							},
						]}
					/>
				</div>
			),
		},
	],
	searchText:
		"campaign settings stat definition action definition attribute definition shared inventory visibility rolls entity health calendar rest short long movement height formula flying initiative terrain environment preset",
};

export default campaignSettingsPage;
