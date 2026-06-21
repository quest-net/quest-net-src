// Script test harness (v2).
//
// Lets a DM paste a script, pick a host + a triggering action, and run it against
// a COPY of the current campaign — never the live game. It shows the resulting
// state diff (fast-json-patch) plus any error, so all script debugging happens
// here while the in-game editor stays simple.
//
// Isolation: we structuredClone the active campaign twice (a "before" snapshot
// and a "working" copy), run the script against a throwaway Context whose
// ActiveCampaign is the working copy, then diff the two. getActiveCampaign and
// every action handler read context.ActiveCampaign, so all effects (including
// cascading game.action calls) land on the working clone and the live campaign is
// untouched.

import { useMemo, useState } from "react";
import { compare } from "fast-json-patch";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import type { Context } from "../../domains/Context/Context";
import {
	ScriptEngine,
	type ScriptHostSelection,
} from "../../services/Scripting/ScriptEngine";

interface HostOption {
	label: string;
	selection: ScriptHostSelection;
}

const DEFAULT_CODE = `// 'this' is the selected host; 'game' and 'event' are in scope.
// Change the world only via await game.action(key, params).
const actor = this.actor ?? game.actors()[0];
if (actor) await game.log("Test harness ran on " + actor.Name);`;

function buildHostOptions(campaign: any): HostOption[] {
	const out: HostOption[] = [
		{ label: "Campaign (world rules)", selection: { kind: "campaign" } },
	];
	if (!campaign) return out;
	const actors = [...campaign.GameState.Characters, ...campaign.GameState.Entities];
	for (const a of actors) {
		const name = a.Name || a.Id;
		out.push({ label: `Actor — ${name}`, selection: { kind: "actor", actorId: a.Id } });
		const addSlots = (
			collection: "Statuses" | "Inventory" | "Equipment" | "Skills",
			slots: any[] | undefined,
			label: string
		) =>
			slots?.forEach((_slot, i) =>
				out.push({
					label: `  ${label} #${i} on ${name}`,
					selection: { kind: "slot", actorId: a.Id, collection, index: i },
				})
			);
		addSlots("Statuses", a.Statuses, "Status");
		addSlots("Inventory", a.Inventory, "Inv item");
		addSlots("Equipment", a.Equipment, "Equipped");
		addSlots("Skills", a.Skills, "Skill");
	}
	return out;
}

function cloneCampaign(campaign: any): any {
	try {
		return structuredClone(campaign);
	} catch {
		return JSON.parse(JSON.stringify(campaign));
	}
}

export function ScriptTestHarness() {
	const context = useQuestContext();
	const campaign = context.ActiveCampaign;

	const hostOptions = useMemo(() => buildHostOptions(campaign), [campaign]);

	const [hostIndex, setHostIndex] = useState(0);
	const [triggerKey, setTriggerKey] = useState("combat:incrementRound");
	const [phase, setPhase] = useState<"before" | "after">("after");
	const [paramsText, setParamsText] = useState("{}");
	const [code, setCode] = useState(DEFAULT_CODE);
	const [output, setOutput] = useState<{
		ok: boolean;
		error?: string;
		patch: string;
		ran: boolean;
		cancelled?: boolean;
		params?: any;
	}>({ ok: true, patch: "", ran: false });

	const handleRun = async () => {
		if (!campaign) return;
		let params: any = {};
		if (paramsText.trim()) {
			try {
				params = JSON.parse(paramsText);
			} catch (e) {
				setOutput({
					ok: false,
					error: `Invalid params JSON: ${String((e as any)?.message ?? e)}`,
					patch: "",
					ran: true,
				});
				return;
			}
		}

		const before = cloneCampaign(campaign);
		const working = cloneCampaign(campaign);
		const fakeContext: Context = {
			...context,
			ActiveCampaign: working,
			IsOptimistic: false,
		};
		const selection = hostOptions[hostIndex]?.selection ?? { kind: "campaign" };
		const result = await ScriptEngine.runForTest({
			context: fakeContext,
			host: selection,
			code,
			triggerKey,
			params,
			phase,
		});
		const patch = compare(before, working);
		setOutput({
			ok: result.ok,
			error: result.error,
			patch: patch.length ? JSON.stringify(patch, null, 2) : "(no state changes)",
			ran: true,
			cancelled: result.cancelled,
			params: result.params,
		});
	};

	if (!campaign) {
		return (
			<div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
				Open a campaign to use the script test harness.
			</div>
		);
	}

	return (
		<div className="space-y-4 rounded-lg border border-base-300 bg-base-100 p-4">
			<div className="grid gap-3 md:grid-cols-2">
				<label className="form-control">
					<span className="label-text mb-1 text-xs opacity-70">Host (`this`)</span>
					<select
						className="select select-bordered select-sm w-full"
						value={hostIndex}
						onChange={(e) => setHostIndex(Number(e.target.value))}
					>
						{hostOptions.map((o, i) => (
							<option key={i} value={i}>
								{o.label}
							</option>
						))}
					</select>
				</label>
				<label className="form-control">
					<span className="label-text mb-1 text-xs opacity-70">
						Triggering action (event.key)
					</span>
					<input
						className="input input-bordered input-sm w-full font-mono"
						value={triggerKey}
						onChange={(e) => setTriggerKey(e.target.value)}
						placeholder="e.g. item:use"
					/>
				</label>
				<label className="form-control">
					<span className="label-text mb-1 text-xs opacity-70">
						Phase (script.When)
					</span>
					<select
						className="select select-bordered select-sm w-full"
						value={phase}
						onChange={(e) => setPhase(e.target.value as "before" | "after")}
					>
						<option value="after">After — react (frozen event)</option>
						<option value="before">Before — intercept (mutable params, event.cancel())</option>
					</select>
				</label>
			</div>

			<label className="form-control">
				<span className="label-text mb-1 text-xs opacity-70">
					event.params (JSON)
				</span>
				<input
					className="input input-bordered input-sm w-full font-mono"
					value={paramsText}
					onChange={(e) => setParamsText(e.target.value)}
					placeholder='{ "actorId": "..." }'
				/>
			</label>

			<label className="form-control">
				<span className="label-text mb-1 text-xs opacity-70">Script code</span>
				<textarea
					className="textarea textarea-bordered w-full font-mono text-xs"
					rows={8}
					value={code}
					onChange={(e) => setCode(e.target.value)}
					spellCheck={false}
				/>
			</label>

			<button className="btn btn-primary btn-sm gap-2" onClick={handleRun}>
				<span className="icon-[mdi--play] h-4 w-4" />
				Run against a copy
			</button>

			{output.ran && (
				<div className="space-y-2">
					{output.error ? (
						<div className="rounded-lg border border-error/40 bg-error/10 p-3 text-sm">
							<span className="font-semibold text-error">Error:</span> {output.error}
						</div>
					) : (
						<div className="rounded-lg border border-success/40 bg-success/10 p-2 text-sm text-success">
							Ran with no errors.
						</div>
					)}
					{phase === "before" && output.ok && (
						<div className="rounded-lg border border-base-300 bg-base-200 p-3 text-xs">
							<div className="mb-1 font-semibold opacity-70">Before-phase outcome</div>
							<div>
								Action{" "}
								{output.cancelled ? (
									<span className="font-semibold text-error">cancelled</span>
								) : (
									<span className="font-semibold text-success">allowed</span>
								)}
							</div>
							<div className="mt-1 opacity-70">Resolved params:</div>
							<pre className="mt-1 max-h-40 overflow-auto font-mono">
								<code>{JSON.stringify(output.params ?? {}, null, 2)}</code>
							</pre>
						</div>
					)}
					<div>
						<div className="mb-1 text-xs font-semibold opacity-70">
							State diff (live campaign untouched)
						</div>
						<pre className="max-h-80 overflow-auto rounded-lg border border-base-300 bg-base-200 p-3 font-mono text-xs text-base-content">
							<code>{output.patch}</code>
						</pre>
					</div>
				</div>
			)}
		</div>
	);
}
