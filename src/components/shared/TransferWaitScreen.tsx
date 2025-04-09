import React from 'react';
import Modal from './Modal';
import { Item } from '../../types/game';
import BasicObjectView from '../ui/BasicObjectView';
import { Loader2 } from 'lucide-react';

interface TransferWaitScreenProps {
  isOpen: boolean;
  onCancel: () => void;
  item: Item;
  recipientName: string;
}

export default function TransferWaitScreen({
  isOpen,
  onCancel,
  item,
  recipientName
}: TransferWaitScreenProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Waiting for Response"
    >
      <div className="flex flex-col items-center relative min-h-[40vh]">

        <div className="flex items-center gap-12 mb-8">
          {/* Source item */}
          <div className="flex flex-col items-center">
            <BasicObjectView
              name={item.name}
              imageId={item.image}
              size="size=md 2xl:size=lg"
            />
            <span className="mt-2 text-xl font-['Mohave']">Your Item</span>
          </div>

          {/* Loading animation */}
          <Loader2 className="w-12 h-12 text-blue dark:text-cyan animate-spin" />

          {/* Recipient */}
          <div className="flex flex-col items-center">
            <div className="w-32 h-32 rounded-lg border-2 border-grey dark:border-offwhite flex items-center justify-center bg-grey/10 dark:bg-offwhite/10">
              <span className="text-2xl font-['BrunoAceSC'] text-center px-4">
                {recipientName}
              </span>
            </div>
            <span className="mt-2 text-xl font-['Mohave']">Recipient</span>
          </div>
        </div>

        <p className="text-xl text-center font-['Mohave'] text-grey dark:text-offwhite/80 mb-8">
          Waiting for {recipientName} to accept the transfer...
        </p>

        <button
          onClick={onCancel}
          className="px-8 py-2 rounded-lg border-2 border-grey dark:border-offwhite 
                    text-grey dark:text-offwhite hover:bg-grey/10 dark:hover:bg-offwhite/10 
                    transition-colors font-['Mohave'] text-lg"
        >
          Cancel Transfer
        </button>
      </div>
    </Modal>
  );
}