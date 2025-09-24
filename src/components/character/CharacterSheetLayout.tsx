import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';

interface CharacterSheetLayoutProps {
  children: React.ReactNode;
}

export function CharacterSheetLayout({ children }: CharacterSheetLayoutProps) {
  return (
    <div className="min-h-screen bg-offwhite dark:bg-grey">
      {/* Character Sheet Header */}
      <div className="bg-white dark:bg-black border-b-2 border-grey dark:border-offwhite">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link 
                to="/" 
                className="flex items-center gap-2 text-grey dark:text-offwhite hover:text-blue dark:hover:text-cyan transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Quest-Net
              </Link>
            </div>
            
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold font-['Mohave'] text-grey dark:text-offwhite">
                Character Sheet
              </h1>
              <span className="text-sm text-grey/60 dark:text-offwhite/60 bg-yellow-100 dark:bg-yellow-900 px-2 py-1 rounded">
                Read Only
              </span>
            </div>
            
            <Link 
              to="/" 
              className="flex items-center gap-2 text-grey dark:text-offwhite hover:text-blue dark:hover:text-cyan transition-colors"
            >
              <Home className="w-5 h-5" />
              Home
            </Link>
          </div>
        </div>
      </div>
      
      {children}
    </div>
  );
}