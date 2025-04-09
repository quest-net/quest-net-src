import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import {ReactComponent as Atom} from '../ui/atom.svg';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
}

const Modal = ({ isOpen, onClose, children, title, className = '' }: ModalProps) => {
  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent scrolling on the body when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      // Restore scrolling when modal is closed
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="relative bg-grey dark:bg-offwhite p-8 rounded-lg overflow-hidden">
        {/* Background layer with negative z-index */}
        <div className="absolute inset-0 pointer-events-none z-10">
          <Atom className="absolute top-0 right-0 w-96 h-96 stroke-offwhite dark:stroke-grey" />
        </div>
        <div className="absolute inset-0 pointer-events-none z-10">
          <Atom className="absolute bottom-0 left-0 rotate-180 w-96 h-96 stroke-offwhite dark:stroke-grey" />
        </div>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-1 left-1 p-[0.25rem] bg-offwhite dark:bg-grey hover:bg-offwhite/90 
            dark:hover:bg-grey/90 rounded-full transition-colors z-20"
          aria-label="Close"
        >
          <X className="w-6 h-6 text-grey dark:text-offwhite" />
        </button>

        {/* Inner content container - no z-index needed */}
        <div className={`relative bg-offwhite dark:bg-grey rounded-lg p-6 w-full min-w-[33vw] max-w-[33vw]
           max-h-[73vh] overflow-hidden flex flex-col z-20 modal-content ${className}`}
        >
          {title && (
            <div className="flex items-center mb-4">
              <h2 className="text-xl bg-blue dark:bg-cyan rounded-lg px-4 
                text-offwhite dark:text-grey font-['BrunoAceSC']"
              >
                {title}
              </h2>
            </div>
          )}
          
          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Modal;