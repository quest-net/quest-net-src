import React, { useState, useEffect } from 'react';
import { Repeat } from 'lucide-react';

interface PartyManagementControlsProps {
  onHealHP: (amount: number) => void;
  onHealMP: (amount: number) => void;
  onRefillItemUses: () => void;
  onRefillSkillUses: () => void;
}

const PartyManagementControls = ({ onHealHP, onHealMP, onRefillItemUses, onRefillSkillUses }: PartyManagementControlsProps) => {
  // Initialize from localStorage if available
  const [hpAmount, setHpAmount] = useState<string>(
    localStorage.getItem('partyHealHPAmount') || ''
  );
  const [mpAmount, setMpAmount] = useState<string>(
    localStorage.getItem('partyHealMPAmount') || ''
  );

  // Save values to localStorage whenever they change
  useEffect(() => {
    if (hpAmount) {
      localStorage.setItem('partyHealHPAmount', hpAmount);
    }
  }, [hpAmount]);

  useEffect(() => {
    if (mpAmount) {
      localStorage.setItem('partyHealMPAmount', mpAmount);
    }
  }, [mpAmount]);

  const handleHealHP = () => {
    const amount = parseInt(hpAmount);
    if (!isNaN(amount)) {
      onHealHP(amount);
    }
  };

  const handleHealMP = () => {
    const amount = parseInt(mpAmount);
    if (!isNaN(amount)) {
      onHealMP(amount);
    }
  };

  const handleReset = () => {
    setHpAmount('');
    setMpAmount('');
    localStorage.removeItem('partyHealHPAmount');
    localStorage.removeItem('partyHealMPAmount');
  };

  return (
    <div className="flex items-center justify-center gap-16 mx-16 bg-offwhite/50 dark:bg-grey/50 rounded-lg p-2">
      <div className="flex items-center gap-2">
        <span className="text-magenta dark:text-red text-2xl font-semibold font-['Mohave']">HP</span>
        <input
          type="number"
          value={hpAmount}
          onChange={(e) => setHpAmount(e.target.value)}
          placeholder="Amount"
          className="w-24 px-2 py-1 bg-white dark:bg-black border rounded"
        />
        <button
          onClick={handleHealHP}
          disabled={!hpAmount}
          className="px-3 py-1 bg-magenta dark:bg-red text-white font-['Mohave'] rounded 
                   disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          Heal
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-purple dark:text-pink font-['Mohave'] text-2xl font-semibold">MP</span>
        <input
          type="number"
          value={mpAmount}
          onChange={(e) => setMpAmount(e.target.value)}
          placeholder="Amount"
          className="w-24 px-2 py-1 bg-white dark:bg-black border rounded"
        />
        <button
          onClick={handleHealMP}
          disabled={!mpAmount}
          className="px-3 py-1 bg-purple dark:bg-pink text-white font-['Mohave'] rounded 
                   disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          Heal
        </button>
      </div>

      <button
        onClick={handleReset}
        className="px-3 py-1 bg-grey/10 dark:bg-offwhite/10 text-grey dark:text-offwhite 
                 font-['Mohave'] rounded hover:bg-grey/20 dark:hover:bg-offwhite/20 
                 transition-colors"
      >
        Reset
      </button>
      {/* Uses Refill Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={onRefillItemUses}
          className="flex items-center gap-2 px-4 py-1.5 border-2 border-blue dark:border-cyan bg-transparent text-blue dark:text-cyan
                   font-['Mohave'] rounded-lg hover:bg-white/20 active:bg-blue dark:active:bg-cyan active:text-white dark:active:text-black transition-opacity"
        >
          <Repeat size={16} />
          Refill Item Uses
        </button>
        <button
          onClick={onRefillSkillUses}
          className="flex items-center gap-2 px-4 py-1.5 border-2 border-blue dark:border-cyan bg-transparent text-blue dark:text-cyan
                   font-['Mohave'] rounded-lg hover:bg-white/20 active:bg-blue dark:active:bg-cyan active:text-white dark:active:text-black transition-opacity"
        >
          <Repeat size={16} />
          Refill Skill Uses
        </button>
      </div>
    </div>
    
  );
};

export default PartyManagementControls;