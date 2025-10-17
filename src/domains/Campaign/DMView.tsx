// domains/Campaign/DMView.tsx

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuestContext } from '../Context/ContextProvider';
import { CampaignActions } from './CampaignActions';
import { CharacterIndex } from '../Character/Index';
import { CampaignSettingEdit } from '../CampaignSetting/Edit';
import { LogDisplay } from '../Log/LogDisplay';
import { PeerStatus } from '../Room/PeerStatus';

type TabView = 'characters' | 'settings';

export function DMView() {
  const { identifier } = useParams<{ identifier: string }>();
  const context = useQuestContext();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabView>('characters');

  const campaign = CampaignActions.findCampaignByIdentifier(identifier!, context);

  if (!campaign) {
    return;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="navbar border-b-2 px-6 justify-between">
        <div className="flex items-center gap-4">
          <div className="badge badge-primary badge-lg font-mono">
            {campaign.RoomCode}
          </div>
          <PeerStatus />
        </div>
        <h1 className="text-xl font-bold">{campaign.Name}</h1>
        <button
          className="btn btn-neutral"
          onClick={() => navigate('/campaigns')}
        >
          Leave Campaign
        </button>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="border-r-2">
          <ul className="menu menu-lg">
            <li>
              <button
                className={activeTab === 'characters' ? 'active' : ''}
                onClick={() => setActiveTab('characters')}
              >
              Characters
              </button>
            </li>
            <li>
              <button
                className={activeTab === 'settings' ? 'active' : ''}
                onClick={() => setActiveTab('settings')}
              >
              Settings
              </button>
            </li>
          </ul>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6">
          {activeTab === 'characters' && <CharacterIndex />}
          {activeTab === 'settings' && <CampaignSettingEdit />}
        </main>
        {/* Log Display*/}
        <LogDisplay />
      </div>
    </div>
  );
}