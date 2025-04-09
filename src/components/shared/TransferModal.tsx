import React, { useState } from 'react';
import { CatalogTabs, CatalogTabsList, CatalogTabsTrigger } from '../ui/CatalogTabs';
import BasicObjectView from '../ui/BasicObjectView';
import Modal from './Modal';
import type { Character, Entity } from '../../types/game';
import {ReactComponent as CharBackground} from '../ui/char.svg';
import {ReactComponent as FieldBackground} from '../ui/field.svg';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  party: Character[];
  field: Entity[];
  onTransfer: (recipientId: string, recipientType: 'character' | 'fieldEntity') => void;
}

export default function TransferModal({
  isOpen,
  onClose,
  party,
  field,
  onTransfer
}: TransferModalProps) {
  const [recipientType, setRecipientType] = useState<'character' | 'fieldEntity'>('character');
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);

  const handleTransfer = () => {
    if (!selectedRecipientId) return;
    onTransfer(selectedRecipientId, recipientType);
    onClose();
  };

  const renderRecipients = () => {
    const recipients = recipientType === 'character' ? party : field;
    
    return (
      <div className="relative h-[45vh] w-full">
        {/* Background */}
        <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
          {recipientType === 'character' ? (
            <CharBackground className="absolute bottom-0 scale-[150%] rotate-[20deg] left-0 h-full fill-grey/20 dark:fill-offwhite/20" />
          ) : (
            <FieldBackground className="absolute -bottom-[50%] left-[95%] scale-[480%] h-full fill-grey/20 dark:fill-offwhite/20" />
          )}
        </div>

        {/* Recipients List */}
        <div className="absolute inset-0 overflow-y-auto scrollable border-2 border-grey dark:border-offwhite rounded-lg">
          <div className="flex flex-wrap justify-center items-start gap-4 p-2 min-h-full">
            {recipients.map(recipient => (
              <div className="flex-none" key={recipient.id}>
                <BasicObjectView
                  name={recipient.name}
                  imageId={recipient.image}
                  id={`recipient-${recipient.id}`}
                  size="size=sm 2xl:size=md 3xl:size=lg"
                  onClick={() => setSelectedRecipientId(recipient.id)}
                  border={{
                    width: selectedRecipientId === recipient.id ? 4 : 2,
                    color: selectedRecipientId === recipient.id ? 'var(--color-blue)' : undefined
                  }}
                />
              </div>
            ))}
            {recipients.length === 0 && (
              <div className="flex items-center justify-center h-40">
                <span className="text-grey dark:text-offwhite text-xl font-['Mohave']">
                  No {recipientType === 'character' ? 'characters' : 'entities'} available
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Transfer Item"
    >
      <div className="flex flex-col h-full">
        <CatalogTabs
          value={recipientType}
          onValueChange={(value) => {
            setRecipientType(value as 'character' | 'fieldEntity');
            setSelectedRecipientId(null);
          }}
        >
          <CatalogTabsList>
            <CatalogTabsTrigger value="character">Characters</CatalogTabsTrigger>
            <CatalogTabsTrigger value="fieldEntity">Field Entities</CatalogTabsTrigger>
          </CatalogTabsList>

          <div className="mt-0">
            {renderRecipients()}
          </div>
        </CatalogTabs>

        <div className="flex justify-end gap-4 mt-4">
          <button
            onClick={onClose}
            className="px-6 py-2 text-grey dark:text-offwhite border-2 border-grey dark:border-offwhite rounded-lg hover:bg-grey/10 dark:hover:bg-offwhite/10 transition-colors font-['Mohave']"
          >
            Cancel
          </button>
          <button
            onClick={handleTransfer}
            disabled={!selectedRecipientId}
            className="px-6 py-2 bg-blue dark:bg-cyan text-offwhite dark:text-grey rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-['Mohave']"
          >
            Transfer
          </button>
        </div>
      </div>
    </Modal>
  );
}