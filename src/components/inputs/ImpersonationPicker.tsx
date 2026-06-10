// components/inputs/ImpersonationPicker.tsx
// DM-only dropdown for selecting an actor to impersonate.

import { useQuestContext, triggerContextUpdate } from "../../domains/Context/ContextProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { UserActions } from "../../domains/User/UserActions";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";

export function ImpersonationPicker() {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

	const impersonatedActorId =
		(context.User.ImpersonatedActors ?? {})[campaign.RoomCode] ?? null;
	const allSpawnedActors = [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
	];
	const impersonatedActor = impersonatedActorId
		? allSpawnedActors.find((a) => a.Id === impersonatedActorId) ?? null
		: null;

	const handleImpersonate = (actorId: string | null) => {
		UserActions.impersonate(
			{ campaignId: campaign.RoomCode, actorId },
			context
		);
		triggerContextUpdate();
	};

	return (
		<div className="flex items-center">
			{/* Dropdown trigger */}
			<div className="dropdown dropdown-end">
				<div
					tabIndex={0}
					role="button"
					className={`btn btn-sm gap-2 ${impersonatedActor ? "btn-primary rounded-r-none border-r-0" : "btn-neutral"}`}
					title={impersonatedActor ? `Acting as ${impersonatedActor.Name}` : "Impersonate an actor"}
				>
					{impersonatedActor ? (
						<>
							{impersonatedActor.Image ? (
								<ImageDisplay
									imageId={impersonatedActor.Image}
									className="w-5 h-5 rounded-full object-cover"
								/>
							) : (
								<span className="icon-[mdi--account] w-5 h-5" />
							)}
							<span className="max-w-24 truncate">{impersonatedActor.Name}</span>
						</>
					) : (
						<span className="icon-[mdi--theater] w-5 h-5" />
					)}
				</div>
				<ul
					tabIndex={0}
					className="dropdown-content z-50 menu p-2 shadow-lg bg-base-200 rounded-box w-56 max-h-64 overflow-y-auto"
				>
					{allSpawnedActors.length === 0 && (
						<li className="disabled">
							<span className="opacity-70">No actors spawned</span>
						</li>
					)}
					{allSpawnedActors.map((actor) => (
						<li key={actor.Id}>
							<button
								onClick={() => handleImpersonate(actor.Id)}
								className={actor.Id === impersonatedActorId ? "active" : ""}
							>
								{actor.Image ? (
									<ImageDisplay
										imageId={actor.Image}
										className="w-5 h-5 rounded-full object-cover"
									/>
								) : (
									<span className="icon-[mdi--account] w-4 h-4" />
								)}
								<span className="truncate">{actor.Name}</span>
							</button>
						</li>
					))}
				</ul>
			</div>

			{/* Stop impersonating button (split-button style) */}
			{impersonatedActor && (
				<button
					className="btn btn-sm btn-primary rounded-l-none"
					onClick={() => handleImpersonate(null)}
					title="Stop impersonating"
				>
					<span className="icon-[mdi--close] w-4 h-4" />
				</button>
			)}
		</div>
	);
}
