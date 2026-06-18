import {
	WikiCallout as Callout,
	WikiCardGrid,
	WikiCode as Code,
	WikiDiagram,
	WikiFieldGrid as FieldGrid,
	WikiFlow,
	WikiFlowStep as FlowStep,
	WikiHighlight,
} from "../components/content";
import type { WikiPage } from "./WikiPage";

export const dataStructuresPage: WikiPage = {
	slug: "data-structures",
	title: "Data Structures",
	audience: "Developer",
	category: "Technical",
	summary: "A developer map of the global context, campaign payload, and core domains.",
	tags: ["context", "campaign", "state", "actions", "schema"],
	icon: "icon-[mdi--database-outline]",
	sections: [
		{
			id: "mental-model",
			title: "Mental Model",
			body: (
				<div className="space-y-4">
					<p>
						Quest-Net keeps one live application object called{" "}
						<Code>Context</Code>. That object is the shell around the current
						user, campaign list, app settings, and the currently opened campaign.
						For DMs, the opened campaign is the authoritative table state.
					</p>
					<Callout tone="accent" title="One table, three layers">
						<WikiCardGrid
							items={[
								{
									title: "Context",
									body: "Small app shell saved through localStorage.",
									tone: "primary",
								},
								{
									title: "Campaign",
									body: "Full game payload unpacked while a table is open.",
									tone: "secondary",
								},
								{
									title: "Stores",
									body: "IndexedDB records for campaigns, images, and voxel blobs.",
									tone: "success",
								},
							]}
						/>
					</Callout>
					<p>
						For DMs using the app, this means the{" "}
						<WikiHighlight tone="primary">campaign list</WikiHighlight> can stay
						lightweight even when maps, images, logs, and character rosters grow
						large. For developers, this means code should treat{" "}
						<Code>Context.ActiveCampaign</Code> as the only full campaign that is
						currently unpacked into React state.
					</p>
				</div>
			),
		},
		{
			id: "context",
			title: "Context",
			body: (
				<div className="space-y-4">
					<p>
						<Code>Context</Code> is defined in <Code>src/domains/Context/Context.ts</Code>.
						It lives in a <WikiHighlight tone="primary">Valtio proxy</WikiHighlight>{" "}
						(<Code>src/domains/Context/contextStore.ts</Code>) that is the single
						source of truth. Components read it through{" "}
						<Code>useQuestContext()</Code> (a Valtio snapshot, so each component
						re-renders only when a field it actually reads changes) and write by
						mutating <Code>contextStore</Code> directly. Persistence is handled by a
						debounced subscription in <Code>ContextProvider</Code>.
					</p>
					<FieldGrid
						items={[
							{
								name: "User",
								detail:
									"Current local user identity, role, display name, and selected characters.",
								tone: "primary",
							},
							{
								name: "Campaigns",
								detail:
									"Lightweight CampaignInfo records. This is metadata only, not the full table payload.",
								tone: "info",
							},
							{
								name: "ActiveCampaign",
								detail:
									"The full Campaign currently opened in the route. Null when no table is active.",
								tone: "secondary",
							},
							{
								name: "AppSettings",
								detail:
									"String-keyed user preferences such as theme and other app-level options.",
								tone: "success",
							},
							{
								name: "IsOptimistic",
								detail:
									"Runtime flag used while a player applies a local prediction before the DM reply arrives.",
								tone: "warning",
							},
							{
								name: "SecretModes",
								detail:
									"DM-only runtime map that suppresses broadcasts for a campaign while private prep is happening.",
								tone: "error",
							},
						]}
					/>
					<Callout tone="warning" title="Developer guardrail">
						<p>
							Mutate <Code>contextStore</Code> (or anything reached through it) —
							never the value returned by <Code>useQuestContext()</Code>, which is
							a frozen Valtio snapshot and throws on write. Reads in render go
							through the snapshot; writes go through the proxy.
						</p>
					</Callout>
				</div>
			),
		},
		{
			id: "campaign-info-vs-campaign",
			title: "CampaignInfo Vs Campaign",
			body: (
				<div className="space-y-4">
					<p>
						Quest-Net separates{" "}
						<WikiHighlight>campaign metadata</WikiHighlight> from the{" "}
						<WikiHighlight>full campaign payload</WikiHighlight>. This prevents
						localStorage from becoming the long-term home for large maps, images,
						logs, and roster data.
					</p>
					<WikiCardGrid
						columns={2}
						items={[
							{
								title: "CampaignInfo",
								tone: "info",
								body: (
									<>
										Lives inside <Code>Context.Campaigns</Code>. It contains{" "}
										<Code>Id</Code>, <Code>RoomCode</Code>, <Code>Name</Code>,{" "}
										<Code>CreatedAt</Code>, <Code>LastActivity</Code>,{" "}
										<Code>CharacterCount</Code>, and <Code>Version</Code>.
									</>
								),
							},
							{
								title: "Campaign",
								tone: "secondary",
								body: (
									<>
										Lives in the IndexedDB <Code>campaigns</Code> store and is
										unpacked into <Code>Context.ActiveCampaign</Code> while open.
										It owns all table data.
									</>
								),
							},
						]}
					/>
					<Callout tone="info" title="DM identity rule">
						<p>
							For a DM, <Code>CampaignInfo.Id</Code> is the private campaign GUID.
							For players, that same metadata slot uses the public{" "}
							<Code>RoomCode</Code>. This mirrors the sanitized campaign state that
							players receive over sync.
						</p>
					</Callout>
				</div>
			),
		},
		{
			id: "campaign",
			title: "Campaign",
			body: (
				<div className="space-y-4">
					<p>
						<Code>Campaign</Code> is the root table payload. It combines global
						collections, the current scene state, campaign settings, and the
						activity log.
					</p>
					<FieldGrid
						items={[
							{
								name: "Id / RoomCode",
								detail:
									"Id is the DM's private campaign identifier. RoomCode is the public join code.",
								tone: "error",
							},
							{
								name: "CharacterRoster",
								detail:
									"Available player characters. Spawned copies used in play live under GameState.Characters.",
								tone: "primary",
							},
							{
								name: "ItemTemplates / SkillTemplates / StatusTemplates",
								detail:
									"Reusable campaign templates. Actors store slot references to these templates by Id.",
								tone: "info",
							},
							{
								name: "EntityTemplates",
								detail:
									"Reusable NPC, monster, object, or encounter actor definitions.",
								tone: "warning",
							},
							{
								name: "VoxelTerrains / Images / Audios / Scenarios",
								detail:
									"Worldbuilding assets and encounter resources owned by the campaign.",
								tone: "success",
							},
							{
								name: "GameState",
								detail:
									"The live session layer: active actors, combat, scene, active terrain, audio, and calendar day.",
								tone: "secondary",
							},
							{
								name: "Settings",
								detail:
									"Campaign-level definitions for stats, actions, attributes, initiative, rests, movement, visibility, and terrain presets.",
								tone: "accent",
							},
							{
								name: "Log / LogHead",
								detail:
									"Chronological activity records plus the current log cursor/head marker.",
								tone: "neutral",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "game-state",
			title: "GameState",
			body: (
				<div className="space-y-4">
					<p>
						<Code>GameState</Code> is the live table layer. If the campaign is the
						binder, game state is the page currently open at the table.
					</p>
					<WikiDiagram title="Live session fields">
						<div className="grid gap-2 text-sm md:grid-cols-2">
							<div>
								<Code>Characters</Code> and <Code>Entities</Code>: active actors
								on the map.
							</div>
							<div>
								<Code>CombatState</Code>: combat activity, round number,
								initiative side, and completed-turn IDs.
							</div>
							<div>
								<Code>Scene</Code>: current environment and focus images.
							</div>
							<div>
								The active terrain is not stored here — each actor's
								<Code>Position.terrainId</Code> determines where it is and what
								renders (multi-terrain worlds).
							</div>
							<div>
								<Code>Audio</Code> and <Code>Volume</Code>: current session audio.
							</div>
							<div>
								<Code>CalendarDay</Code> and <Code>RemainingShortRests</Code>:
								time and rest tracking.
							</div>
						</div>
					</WikiDiagram>
					<Callout tone="success" title="DM guide translation">
						<p>
							When a DM starts combat, changes the active terrain, advances the
							calendar, moves a token, or changes the current scene, they are
							changing <Code>GameState</Code>.
						</p>
					</Callout>
				</div>
			),
		},
		{
			id: "actors-and-slots",
			title: "Actors And Slots",
			body: (
				<div className="space-y-4">
					<p>
						<Code>Character</Code> and <Code>Entity</Code> both use the shared{" "}
						<Code>Actor</Code> shape. Characters add private <Code>Notes</Code> and
						an optional <Code>CritMessage</Code>; entities are currently just
						actors.
					</p>
					<Callout tone="accent" title="Template plus slot pattern">
						<p>
							Campaign settings define reusable stat, action, and attribute
							templates. Actors store <WikiHighlight>slots</WikiHighlight> that
							reference those templates by <Code>Id</Code>, then keep per-actor
							values such as current health, max charges, or attribute text.
						</p>
					</Callout>
					<FieldGrid
						items={[
							{
								name: "StatSlot",
								detail:
									"References a StatDefinition. Stores Current, Max, optional regen, rest behavior, and overflow overrides.",
								tone: "error",
							},
							{
								name: "ActionSlot",
								detail:
									"References an ActionDefinition. Stores Max actions per turn and Current remaining actions.",
								tone: "warning",
							},
							{
								name: "AttributeSlot",
								detail:
									"References an AttributeDefinition. Stores the actor-specific string value.",
								tone: "info",
							},
							{
								name: "Inventory / Equipment / Skills / Statuses",
								detail:
									"Reference campaign templates or applied statuses by Id, with optional UsesLeft or expiration state.",
								tone: "success",
							},
							{
								name: "Position",
								detail:
									"Uses terrainId, x, y, and h fields. terrainId is which voxel terrain the actor occupies; h is map height/elevation for actor placement.",
								tone: "secondary",
							},
							{
								name: "TurnStartPosition",
								detail:
									"Combat-only snapshot used to compute remaining movement budget during a turn.",
								tone: "accent",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "storage",
			title: "Storage Boundaries",
			body: (
				<div className="space-y-4">
					<p>
						Storage is split by payload size and access pattern. Small app state is
						saved to localStorage, while large or binary records use IndexedDB.
					</p>
					<WikiCardGrid
						items={[
							{
								title: "localStorage",
								tone: "primary",
								body: (
									<>
										Stores the serialized <Code>Context</Code>: user, campaign
										metadata, settings, version, and the active unpacked campaign.
									</>
								),
							},
							{
								title: "campaigns",
								tone: "secondary",
								body: "IndexedDB store for full campaign payloads, version stamps, and save timestamps.",
							},
							{
								title: "voxelTerrains",
								tone: "success",
								body: "IndexedDB store for large SVO voxel strings keyed by campaign and terrain ID.",
							},
						]}
					/>
					<Callout tone="warning" title="Terrain hydration rule">
						<p>
							Inactive voxel terrains are packed into IndexedDB and stripped down
							to metadata stubs. The active terrain is hydrated when a campaign is
							loaded, and editing loads a hydrated draft.
						</p>
					</Callout>
				</div>
			),
		},
		{
			id: "resetting-local-state",
			title: "Resetting Local State",
			body: (
				<div className="space-y-4">
					<p>
						Clearing localStorage from the dev tools panel and then refreshing{" "}
						<WikiHighlight tone="warning">does not</WikiHighlight> wipe the
						context. <Code>ContextProvider</Code> registers a{" "}
						<Code>beforeunload</Code> (and unmount) handler that flushes the live
						in-memory context back to localStorage via{" "}
						<Code>ContextService.save</Code> right as the page unloads. So the
						refresh re-persists everything you just deleted before the fresh page
						loads. This is great for crash safety, but it means a manual clear
						loses the race.
					</p>
					<Callout tone="success" title="Why this protects users">
						<p>
							The same handler is why it is hard for a real user to lose their
							table by accident: any reload, tab close, or navigation re-saves
							the current context first.
						</p>
					</Callout>
					<p>
						To fully reset a dev environment, run this in the app tab's console.
						Neutralizing <Code>setItem</Code> makes the unload-time flush a no-op
						so the reload starts from an empty store:
					</p>
					<pre className="my-4 overflow-x-auto rounded-lg border border-base-300 bg-base-200/70 p-4 font-mono text-sm leading-6">
						{`localStorage.clear();
indexedDB.deleteDatabase('quest-net-db');
Storage.prototype.setItem = () => {}; // block the beforeunload re-save
location.reload();`}
					</pre>
					<Callout tone="info" title="Server-down alternative">
						<p>
							Without console hacks: close every app tab, stop the dev server,
							open a fresh tab to the app URL (it fails to connect, so no app JS
							runs), clear localStorage and the <Code>quest-net-db</Code>{" "}
							IndexedDB for that origin, then restart the server. With no running
							app there is nothing to re-save.
						</p>
					</Callout>
				</div>
			),
		},
		{
			id: "actions",
			title: "Actions",
			body: (
				<div className="space-y-4">
					<p>
						All meaningful campaign mutations should flow through{" "}
						<Code>ACTION_REGISTRY</Code>. Each action key maps to allowed roles and
						a domain handler.
					</p>
					<WikiFlow>
						<FlowStep number="1" title="UI calls ActionService.execute">
							Components request a named action such as <Code>actor:move</Code>{" "}
							or <Code>terrain:moveActors</Code>.
						</FlowStep>
						<FlowStep number="2" title="Role permission is checked">
							<Code>canPerformAction</Code> verifies that the local user role can
							attempt that action.
						</FlowStep>
						<FlowStep number="3" title="DM or player path runs">
							DMs execute handlers locally and broadcast the result. Players run an
							optimistic local update, then send an <Code>actionReq</Code> to the
							DM.
						</FlowStep>
						<FlowStep number="4" title="Authoritative state wins">
							The DM validates the request in the requesting player's context,
							mutates the campaign, packs inactive terrain data, and broadcasts
							the resulting campaign state.
						</FlowStep>
					</WikiFlow>
					<Callout tone="info" title="Where to add new behavior">
						<p>
							Add domain handlers beside the domain model, register them in{" "}
							<Code>ACTION_REGISTRY</Code>, and keep direct component mutation out
							of the UI. That keeps permission checks, logs, optimistic updates,
							and network sync on the same path.
						</p>
					</Callout>
				</div>
			),
		},
	],
	searchText:
		"context campaign state actions schema action registry dm authority player request localStorage indexeddb CampaignInfo ActiveCampaign GameState Actor StatSlot ActionSlot AttributeSlot VoxelTerrain TerrainStorageService CampaignLoadingService optimistic secret mode reset clear localStorage wipe fresh start beforeunload flush quest-net-db deleteDatabase console",
};

export default dataStructuresPage;
