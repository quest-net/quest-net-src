import React, { useState, useEffect } from 'react';
import { Notebook as NotebookIcon, X as CloseIcon, ChevronLeft as BackIcon, Eraser } from 'lucide-react';

interface NotebookProps {
    characterName: string;
  }

  export const Notebook: React.FC<NotebookProps> = ({ characterName }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [currentEntry, setCurrentEntry] = useState<string | null>(null);

  // Load saved notes from localStorage
  useEffect(() => {
    const savedNotes = localStorage.getItem('player-notes');
    if (savedNotes) setNotes(JSON.parse(savedNotes));
  }, []);

  // Save notes to localStorage
  useEffect(() => {
    localStorage.setItem('player-notes', JSON.stringify(notes));
  }, [notes]);

  const handleCreateEntry = () => {
    const id = Date.now().toString(); // Unique ID based on timestamp
    setNotes({ ...notes, [id]: '' });
    setCurrentEntry(id);
  };

  const handleDeleteEntry = (id: string) => {
    const updatedNotes = { ...notes };
    delete updatedNotes[id];
    setNotes(updatedNotes);
    if (currentEntry === id) setCurrentEntry(null);
  };

  const handleUpdateEntry = (id: string, content: string) => {
    setNotes({ ...notes, [id]: content });
  };

  return (
    <div className="fixed -bottom-0 -right-0 z-50">
      {/* Toggle Button */}
      <button
        onClick={() => setIsVisible(!isVisible)}
        className="w-24 h-24 2xl:w-32 2xl:h-32 flex items-center justify-center bg-grey dark:bg-offwhite text-white dark:text-grey shadow-md"
        style={{
          clipPath: 'polygon(0 100%, 100% 100%, 100% 0)',
          WebkitClipPath: 'polygon(0 100%, 100% 100%, 100% 0)',
        }}
        aria-label="Toggle Notebook"
      >
        <NotebookIcon
          size={48}
          className="absolute hidden xl:hidden 2xl:block"
          style={{
            bottom: '25%',
            right: '25%',
            transform: 'translate(33%, 33%)',
          }}
        />
        <NotebookIcon
          size={32}
          className="absolute hidden xl:block 2xl:hidden"
          style={{
            bottom: '25%',
            right: '25%',
            transform: 'translate(33%, 33%)',
          }}
        />
      </button>

      {/* Notebook Panel */}
      <div
        className={`fixed bottom-0 right-0 transform transition-transform duration-300 ${
          isVisible ? 'translate-y-0' : 'translate-y-full'
        } w-full md:w-[500px] bg-offwhite dark:bg-grey shadow-lg border-grey dark:border-offwhite border-2 rounded-t-md`}
        style={{ height: '650px' }}
      >
        <div className="p-4 h-full flex flex-col">
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            {currentEntry ? (
              <button
                onClick={() => setCurrentEntry(null)}
                className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
                aria-label="Back to List"
              >
                <BackIcon size={24} />
              </button>
            ) : (
                <h2 className="text-lg font-bold">{characterName}'s Notebook</h2>
            )}
            <button
              onClick={() => setIsVisible(false)}
              className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
              aria-label="Close Notebook"
            >
              <CloseIcon size={24} />
            </button>
          </div>

          {/* Content */}
          {currentEntry ? (
            <textarea
              className="flex-1 p-2 border border-gray-300 rounded dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              value={notes[currentEntry]}
              onChange={(e) => handleUpdateEntry(currentEntry, e.target.value)}
              placeholder="Write your notes here..."
              style={{
                backgroundImage:
                  'repeating-linear-gradient(transparent, transparent 29px, #d1d5db 30px)',
                backgroundSize: '100% 30px',
                lineHeight: '30px',
              }}
            />
          ) : (
            <div className="flex-1 overflow-y-auto">
              {Object.entries(notes).map(([id, content]) => (
                <div
                  key={id}
                  className="flex items-center justify-between p-2 border-b border-grey dark:border-offwhite hover:bg-grey/20 dark:hover:bg-offwhite/20 rounded-t-md"
                >
                  <button
                    onClick={() => setCurrentEntry(id)}
                    className="text-left flex-1"
                  >
                    {content.split('\n')[0] || 'Untitled Note'}
                  </button>
                  <button
                    onClick={() => handleDeleteEntry(id)}
                    className="text-red-500 hover:text-red-700"
                    aria-label="Delete Entry"
                  >
                    <Eraser size={20} />
                  </button>
                </div>
              ))}
              <button
                onClick={handleCreateEntry}
                className="w-full py-2 my-2 text-center text-white dark:text-black dark:bg-cyan dark:hover:bg-cyan-500 bg-blue rounded-full hover:bg-blue-500"
              >
                + Create New Note
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
