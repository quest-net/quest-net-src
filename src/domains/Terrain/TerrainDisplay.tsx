// domains/Terrain/TerrainDisplay.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";

export default function TerrainDisplay() {
  const context = useQuestContext();
  const campaign = CampaignActions.getActiveCampaign(context);

  const activeTerrain =
    campaign.Terrains.find((t) => t.Id === campaign.GameState.TerrainId) ||
    campaign.Terrains.find((t) => t.Id === "DEFAULT_TERRAIN");

  const name = activeTerrain?.Name ?? "Unknown Terrain";

  return (
    <div className="text-center h-full place-content-center">
      <div className="text-2xl font-semibold">Currently in <span className="font-bold">{name}</span></div>
      <div className="h-1 mx-auto w-100 bg-linear-to-r from-transparent via-primary to-transparent mt-1" />
    </div>
  );
}
