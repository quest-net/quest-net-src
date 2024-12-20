import React from 'react';
import Modal from './Modal';
import { Item } from '../../types/game';
import BasicObjectView from '../ui/BasicObjectView';
import { Check, X } from 'lucide-react';

interface TransferRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: Item;
  senderName: string;
  onAccept: () => void;
  onReject: () => void;
}

export default function TransferRequestModal({
  isOpen,
  onClose,
  item,
  senderName,
  onAccept,
  onReject
}: TransferRequestModalProps) {
  const handleAccept = () => {
    onAccept();
    onClose();
  };

  const handleReject = () => {
    onReject();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Transfer Request"
    >
      <div className="flex flex-col items-center relative min-h-[40vh]">

        <p className="text-2xl font-['Mohave'] text-center mb-8">
          <span className="font-['BrunoAceSC'] text-blue dark:text-cyan">{senderName}</span>
          {' '}wants to transfer an item to you:
        </p>

        {/* Item display */}
        <div className="mb-8">
          <BasicObjectView
            name={item.name}
            imageId={item.image}
            size="xl"
          />
        </div>

        {/* Item details */}
        <div className="bg-grey/10 dark:bg-offwhite/10 rounded-lg p-4 mb-8 max-w-xl">
          <h3 className="text-xl font-['BrunoAceSC'] mb-2">{item.name}</h3>
          <p className="font-['Mohave'] text-grey dark:text-offwhite/80">
            {item.description}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-4">
          <button
            onClick={handleReject}
            className="flex items-center gap-2 px-8 py-3 rounded-lg bg-magenta dark:bg-red
                      text-white dark:text-grey hover:opacity-90 transition-colors font-['Mohave'] text-lg"
          >
            <X className="w-5 h-5" />
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="flex items-center gap-2 px-8 py-3 rounded-lg bg-blue-500 dark:bg-cyan
                      text-white dark:text-grey hover:opacity-90 transition-colors font-['Mohave'] text-lg"
          >
            <Check className="w-5 h-5" />
            Accept
          </button>
        </div>
      </div>
    </Modal>
  );
}