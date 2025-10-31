// domains/Main/Main.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import Map from "../../components/Map/Map";
import { useEffect, useState } from "react";

export function Main() {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);
	const [mapKey, setMapKey] = useState(0);

	// Force map remount when component becomes visible again
	useEffect(() => {
		setMapKey(prev => prev + 1);
	}, []);

	return (
		<Map
			key={mapKey}
			characters={campaign.GameState.Characters}
			entities={campaign.GameState.Entities}
			terrain={campaign.Terrains.find(
				(t) => t.Id === campaign.GameState.TerrainId
			)}
		/>
	);
}