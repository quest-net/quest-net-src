// domains/Terrain/TerrainDisplay.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { TerrainStorageService } from "../../services/TerrainStorageService";

export default function TerrainDisplay() {
  const context = useQuestContext();
  const campaign = CampaignActions.getActiveCampaign(context);

  const activeTerrain =
    campaign.VoxelTerrains.find((t) => t.Id === campaign.GameState.VoxelTerrainId)

  const name = activeTerrain?.Name ?? "Unknown Terrain";
  const isLoaded = TerrainStorageService.isHydrated(activeTerrain);

  return (
    <div className="text-center h-full place-content-center">
      <div className="text-2xl font-semibold">Currently in <span className="font-bold">{name}</span></div>
      {!isLoaded && <div className="text-sm opacity-70 mt-1">Loading terrain data...</div>}
      <div className="h-1 mx-auto w-100 bg-linear-to-r from-transparent via-primary to-transparent mt-1" />
    </div>
  );
}
