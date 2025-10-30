// domains/Main/Main.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import Map from "../../components/Map/Map";

export function Main() {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

	return (
		<Map
			characters={campaign.GameState.Characters}
			entities={campaign.GameState.Entities}
			combatState={campaign.GameState.CombatState}
			terrain={campaign.Terrains.find(
				(t) => t.Id === campaign.GameState.TerrainId
			)}
		/>
	);
}
