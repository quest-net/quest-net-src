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
import type { WikiPageDefinition } from "./WikiPage";

const combatPage: WikiPageDefinition = {
	slug: "combat",
	title: "Running Combat",
	audience: "DM Guide",
	category: "Run The Game",
	summary:
		"How to start a fight, track rounds and initiative, mark turns done, and end combat cleanly.",
	tags: ["combat", "initiative", "rounds", "turns", "party", "enemies", "dm"],
	icon: "icon-[mdi--sword-cross]",
	order: 10,
	sections: [
		{
			id: "overview",
			title: "How Combat Works",
			order: 0,
			body: (
				<div className="space-y-4">
					<p>
						Combat is a structured session mode that adds a round counter,
						turn-order tracking, and per-round automation on top of the normal
						campaign view. The DM is the only one who can start, advance, or end
						combat — players see the current state but cannot change it.
					</p>
					<p>
						Quest-Net supports two round structures, chosen in{" "}
						<WikiHighlight tone="secondary">Initiative Settings</WikiHighlight>:
					</p>
					<WikiCardGrid
						columns={2}
						items={[
							{
								title: "Party Mode",
								tone: "primary",
								body: "Party and enemies take turns in alternating rounds. One side acts completely before the other. This maps naturally to games like D&D 4e or many OSR systems.",
							},
							{
								title: "Individual Mode",
								tone: "secondary",
								body: "Every actor — party and enemies together — shares a single round and is sorted against each other by initiative. Common in D&D 5e and Pathfinder.",
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "initiative-settings",
			title: "Configuring Initiative",
			order: 1,
			body: (
				<div className="space-y-4">
					<p>
						Before or during combat, open the{" "}
						<WikiHighlight tone="neutral">gear icon</WikiHighlight> in the Combat
						panel to configure initiative. Changes save immediately to Campaign
						Settings. The mode is locked while combat is active — set it before
						you start.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Mode",
								tone: "primary",
								detail:
									"Party or Individual. Determines round structure (see above). Cannot be changed once combat is running.",
							},
							{
								name: "Sources",
								tone: "secondary",
								detail:
									"An ordered chain of sort keys — stat, attribute, or Move Speed. The first source is the primary sort; later ones break ties. All sources sort greatest-first.",
							},
						]}
					/>
					<WikiCallout tone="info" title="No sources = no order display">
						<p>
							If Sources is empty, no initiative order is shown and the active-actor
							banner is hidden. You can still run combat rounds without an
							ordering — useful for theater-of-the-mind play where the DM calls on
							actors ad hoc.
						</p>
					</WikiCallout>
					<p>
						Actors with no value for any configured source (unset stat, missing
						attribute, no move speed) are placed at the bottom of the initiative
						order and share a single tail rank.
					</p>
				</div>
			),
		},
		{
			id: "starting-combat",
			title: "Starting Combat",
			order: 2,
			body: (
				<div className="space-y-4">
					<p>
						Open the <WikiHighlight tone="neutral">Combat panel</WikiHighlight>{" "}
						from the main campaign view. When combat is not active you will see a
						Start button (or two, in party mode).
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Set up the scene" tone="primary">
							Place characters and entities on the map, assign stats, and confirm
							initiative sources are configured the way you want them.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Choose who goes first" tone="secondary">
							In <strong>party mode</strong>, pick whether the party or enemies
							have initiative in round 1. In <strong>individual mode</strong>,
							there is one Start button — everyone shares the round.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Combat begins" tone="success">
							The round counter resets to 1, all actor positions are snapshotted
							as turn-start positions (for movement range display), and a log entry
							is written.
						</WikiFlowStep>
					</WikiFlow>
				</div>
			),
		},
		{
			id: "round-structure",
			title: "Rounds and Initiative",
			order: 3,
			body: (
				<div className="space-y-4">
					<p>
						Once combat is running, the Combat panel shows the round counter and
						the active initiative side (party mode) or all actors (individual mode).
						The banner reads <em>"It is now [Name]'s turn"</em> for the
						lowest-ranked actor who hasn't acted yet.
					</p>
					<WikiDiagram title="Party mode round cycle">
						<div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Round 1 — Party" tone="primary">
								Party members act. Enemies wait.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Round 2 — Enemies" tone="error">
								Enemies act. Party waits.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Round 3 — Party" tone="primary">
								Initiative flips back.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="..." tone="neutral">
								Continues until combat ends.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiCallout tone="success" title="Individual mode">
						<p>
							In individual mode every actor — party members and entities alike —
							appears in one sorted list. The round advances when all actors have
							been marked done. Initiative side still exists on the data but has no
							visible effect.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "marking-turns",
			title: "Marking Turns Done",
			order: 4,
			body: (
				<div className="space-y-4">
					<p>
						Any actor in the active side's pool can be marked done by clicking the
						turn badge next to their name in the Party or Overview panels — or via
						the active-actor banner in the Combat panel itself. Clicking again
						untogles it, in case of mistakes.
					</p>
					<WikiCardGrid
						columns={2}
						items={[
							{
								title: "DM can mark any actor",
								tone: "primary",
								body: "The DM can mark both party members and entities as done. Useful when running NPCs or handling disconnected players.",
							},
							{
								title: "Players mark their own",
								tone: "secondary",
								body: "Players can mark their own character's turn done. The UI limits which actors they can interact with.",
							},
						]}
					/>
					<p>
						Initiative order is recalculated live at render time — not stored.
						Changing a stat used as an initiative source mid-combat will
						immediately reorder actors. Marks from{" "}
						<WikiHighlight tone="accent">RoundCompleted</WikiHighlight> are
						cleared when the round advances.
					</p>
				</div>
			),
		},
		{
			id: "advancing-rounds",
			title: "Advancing and Rewinding Rounds",
			order: 5,
			body: (
				<div className="space-y-4">
					<p>
						Use the <WikiHighlight tone="neutral">chevron buttons</WikiHighlight>{" "}
						flanking the round counter to step forward or back. Advancing a round
						is the primary automation trigger.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Advance round (forward)",
								tone: "success",
								detail:
									"Increments the counter, flips initiative side (party mode only), clears RoundCompleted, snapshots new turn-start positions for the acting side, applies regen to all actors and shared inventory pools, resets action counts, and decrements turn-based status durations (removing any that expire).",
							},
							{
								name: "Rewind round (back)",
								tone: "warning",
								detail:
									"Decrements the counter (minimum round 1), flips initiative side back (party mode), clears RoundCompleted, reverses regen on all actors and pools, resets action counts. Status durations are NOT reversed — adjust them manually if needed.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="Regen and rewind">
						<p>
							Regen is reversed when rewinding — stats are decremented by the same
							amount they were incremented. Status duration decrements are not
							reversed; Quest-Net takes the stance that reversing complex
							status-expiry state consistently is impractical.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "per-round-automation",
			title: "What Happens Each Round",
			order: 6,
			body: (
				<div className="space-y-4">
					<p>
						When you advance to the next round, Quest-Net automatically handles
						several bookkeeping tasks so you don't have to track them manually.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Regen applied" tone="primary">
							Every actor with a non-zero <strong>RegenRate</strong> on a stat has
							that stat restored by the configured amount, clamped between 0 and
							Max. Any surplus beyond Max is discarded.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Shared inventory regen" tone="secondary">
							Shared inventory pools with their own RegenRate also tick, clamped
							between 0 and Max; surplus is discarded.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Actions reset" tone="accent">
							Every actor's action counts are restored to their Max value, so
							the next round starts with a full action budget.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Status durations tick" tone="warning">
							Turn-based statuses have their remaining-turns counter decremented by
							1. Any status that reaches 0 is removed automatically.
						</WikiFlowStep>
					</WikiFlow>
				</div>
			),
		},
		{
			id: "ending-combat",
			title: "Ending Combat",
			order: 7,
			body: (
				<div className="space-y-4">
					<p>
						Click <WikiHighlight tone="neutral">End</WikiHighlight> in the Combat
						panel. Quest-Net cleans up combat state and triggers any
						end-of-combat restore rules configured in Campaign Settings.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Character restore rules",
								tone: "primary",
								detail:
									'Each character has stats that can be configured to restore on "combatEnd". Those stats are reset according to their RestoreRule when combat ends.',
							},
							{
								name: "Shared inventory restore",
								tone: "secondary",
								detail:
									"Shared inventory pool stats also apply combatEnd restore rules.",
							},
							{
								name: "Turn-based statuses cleared",
								tone: "warning",
								detail:
									'Statuses with expiration type "turns" are removed from all actors. Permanent statuses and non-turn statuses survive.',
							},
							{
								name: "Turn-start positions cleared",
								tone: "neutral",
								detail:
									"The TurnStartPosition snapshot (used for remaining-movement display) is deleted from every actor so it does not persist as stale data.",
							},
							{
								name: "Action counts reset",
								tone: "accent",
								detail:
									"All actors have their action counts reset to Max, matching the fresh state at the start of any round.",
							},
							{
								name: "Round counter reset",
								tone: "info",
								detail:
									"currentRound returns to 0 and isActive becomes false. The combat state is fully cleared.",
							},
						]}
					/>
					<WikiCallout tone="info" title="Permanent statuses survive">
						<p>
							Only turn-based statuses are removed at combat end. Statuses
							configured with a permanent or session-scoped expiration stay on
							actors. Review them manually if the encounter had lasting effects.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "movement-in-combat",
			title: "Movement During Combat",
			order: 8,
			body: (
				<div className="space-y-4">
					<p>
						When combat is active and initiative is configured, the 3D map can
						show each actor's <strong>remaining movement range</strong> rather than
						their full movement budget. The range display subtracts the cost of
						the cheapest path from the actor's turn-start position to their
						current position, so movement spent earlier in the round is visible.
					</p>
					<WikiCardGrid
						columns={2}
						items={[
							{
								title: "Turn-start snapshot",
								tone: "primary",
								body: "When a round begins for a side (or for everyone in individual mode), each actor's current position is snapshotted as TurnStartPosition. The map uses this as the movement budget anchor.",
							},
							{
								title: "Spent movement",
								tone: "warning",
								body: "Moving an actor during their turn deducts from the visible range. If they backtrack, the display recalculates — it always shows the cheapest-path cost from the snapshot position.",
							},
						]}
					/>
					<WikiCallout tone="success" title="Movement reference">
						<p>
							For details on how movement range is computed (Dijkstra, height
							costs, flying), see{" "}
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
		"combat start end round initiative party enemies individual mode turn done mark actor regen status expire clear restore movement TurnStartPosition CombatState incrementRound decrementRound RoundCompleted initiativeSide currentRound",
};

export default combatPage;
