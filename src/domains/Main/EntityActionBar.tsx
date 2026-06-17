// domains/Main/EntityActionBar.tsx
// Extensible action bar for entity-specific actions in the Inspector.
// Renders context-dependent buttons based on the entity's state/tags.

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Actor } from "../Actor/Actor";
import { isItemEntity, getItemDataFromEntity } from "../Item/ItemDropUtils";

interface EntityActionBarProps {
	actor: Actor;
}

/**
 * Renders action buttons relevant to the selected entity.
 * Currently supports:
 *   - "Pick Up" for item entities (dropped items on the ground)
 *
 * Extend by adding new sections for other entity types/tags.
 */
export function EntityActionBar({ actor }: EntityActionBarProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const isPlayer = context.User.Role === "player";
	const myCharacterId = context.User.SelectedCharacters[campaign.RoomCode];
	const impersonatedActorId = (context.User.ImpersonatedActors ?? {})[campaign.RoomCode];

	// Determine who would pick up the item
	const pickupActorId = isPlayer ? myCharacterId : impersonatedActorId;
	const pickupActor = pickupActorId
		? (campaign.GameState.Characters.find((c) => c.Id === pickupActorId) ??
			campaign.GameState.Entities.find((e) => e.Id === pickupActorId))
		: null;

	const actions: React.ReactElement[] = [];

	// Item entity: show "Pick Up" button
	if (isItemEntity(actor)) {
		const itemData = getItemDataFromEntity(actor);
		const itemName = itemData?.Name ?? "Item";

		const handlePickup = () => {
			if (!actionService || !pickupActorId) return;
			actionService.execute("item:pickup", {
				entityId: actor.Id,
				actorId: pickupActorId,
			});
		};

		actions.push(
			<button
				key="pickup"
				onClick={handlePickup}
				disabled={!actionService || !pickupActorId}
				className="btn btn-sm btn-success gap-1"
				title={
					pickupActor
						? `Pick up ${itemName} as ${pickupActor.Name}`
						: isPlayer
							? "Select a character first"
							: "Impersonate an actor first"
				}
			>
				<span className="icon-[mdi--hand-extended] w-4 h-4" />
				Pick up
			</button>
		);
	}

	// Future: add more entity-specific actions here
	// e.g. if (isTrapEntity(actor)) { ... }

	if (actions.length === 0) return null;

	return <div className="flex flex-wrap gap-2">{actions}</div>;
}
