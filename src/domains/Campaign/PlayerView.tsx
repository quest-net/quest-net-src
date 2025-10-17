// domains/Campaign/PlayerView.tsx

import { useNavigate, useParams } from 'react-router-dom';
import { useQuestContext } from '../Context/ContextProvider';
import { CampaignActions } from './CampaignActions';
import { LogDisplay } from '../Log/LogDisplay';
import { PeerStatus } from '../Room/PeerStatus';

export function PlayerView() {
  const { identifier } = useParams<{ identifier: string }>();
  const context = useQuestContext();
  const navigate = useNavigate();
  const campaign = CampaignActions.findCampaignByIdentifier(identifier!, context);

  if (!campaign) {
    return null;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="navbar border-b-2 px-6 justify-between">
        <div className="flex items-center gap-4">
          <PeerStatus />
        </div>
        <h1 className="text-xl font-bold">{campaign.Name}</h1>
        <div className="flex-none">
          <button
            className="btn btn-neutral"
            onClick={() => navigate('/campaigns')}
          >
            Leave Campaign
          </button>
        </div>
      </header>

      {/* Main Content Area (empty for now) */}
      <main className="flex-1 overflow-auto p-6">
        <p className="text-center text-base-content opacity-50">
          Player view - content coming soon
        </p>
      </main>
      {/* Log Display*/}
      <LogDisplay />
    </div>
  );
}