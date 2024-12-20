import React from 'react';
import { Cog, Save, Upload, Trash2, Shield } from 'lucide-react';
import { GameState } from '../../../types/game';
import ExportSaveDialog from '../ExportSaveDialog';
import ImportSaveDialog from '../ImportSaveDialog';

interface SettingsTabProps {
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  isRoomCreator: boolean;
}

export function SettingsTab({ gameState, onGameStateChange, isRoomCreator }: SettingsTabProps) {
  if (!isRoomCreator) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Only the room creator can access settings.</p>
      </div>
    );
  }

  return (
    <div className="flex justify-center h-full">
      <section className="w-[480px] mt-8">
        <div className="flex items-center gap-2 mb-4">
          <Save className="w-5 h-5 text-blue dark:text-cyan" />
          <h2 className="text-xl font-['BrunoAceSC']">Save Management</h2>
        </div>
        
        <div className="flex justify-between items-center gap-8">
          {/* Export Options */}
          <div>
            <ExportSaveDialog gameState={gameState} />
          </div>

          {/* Import Option */}
          <div>
            <ImportSaveDialog
              gameState={gameState}
              onImport={onGameStateChange}
            />
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          <p>Note: Exporting without images will reduce file size but requires images to be re-uploaded upon import.</p>
        </div>
      </section>
    </div>
  );
}

export default SettingsTab;