// domains/Inspector/Inspector.tsx
import { useMapState } from '../../components/Map/MapStateProvider';
import { useQuestContext } from '../Context/ContextProvider';
import { CampaignActions } from '../Campaign/CampaignActions';

export function Inspector() {
  const { selectedActor } = useMapState();
  const context = useQuestContext();
  
  if (!selectedActor) {
    return (
      <div className="text-center text-sm opacity-60">
        Select an actor on the map to inspect
      </div>
    );
  }

  const campaign = CampaignActions.getActiveCampaign(context);
  
  // Find the full actor data
  const actor = selectedActor.kind === "character"
    ? campaign.GameState.Characters.find(c => c.Id === selectedActor.id)
    : campaign.GameState.Entities.find(e => e.Id === selectedActor.id);

  if (!actor) {
    return <div>Actor not found</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">{actor.Name}</h2>
      <p className="text-sm opacity-70">{selectedActor.kind}</p>
      
      {/* Display actor properties */}
      <div className="space-y-2">
        <div><strong>Position:</strong> ({actor.Position.x}, {actor.Position.y}, {actor.Position.h})</div>
        <div><strong>Move Speed:</strong> {actor.MoveSpeed}</div>
        <div><strong>Can Fly:</strong> {actor.CanFly ? 'Yes' : 'No'}</div>
        
        {/* Add more fields as needed */}
      </div>
    </div>
  );
}