// components/IndexView/IndexView.tsx

import { useState, ReactNode, useEffect } from 'react';
import { ImageDisplay } from '../../domains/Image/ImageDisplay';
import { getFoldersAtPath, getItemsAtPath, replacePathTag, removePathTag, FolderInfo, extractPathTags } from '../../utils/FolderUtils';

// ============================================================================
// TYPES
// ============================================================================

export interface IndexViewItem {
  id: string;
  label: string;
  details?: string;
  imageId?: string;
  icon?: string;        // NEW: Iconify icon class (e.g., 'icon-[mdi--terrain]')
  iconColor?: string;   // NEW: Color for the icon (e.g., '#22c55e')
  tags?: string[];
  action?: {
    label: string;
    icon?: string;
    onClick: () => void;
    disabled?: boolean;
  };
}

interface IndexViewProps {
  // Data
  items: IndexViewItem[];
  
  // Header
  title: string;
  description?: string;
  createLabel?: string;
  onCreateClick?: () => void;
  
  // Features
  searchEnabled?: boolean;
  searchPlaceholder?: string;
  
  // Drawer content
  renderEditForm: (item: IndexViewItem | null, context: { currentPath: string[] }) => ReactNode;
  
  // Folder support - callback for bulk tag updates
  onBulkUpdateItemTags?: (updates: Array<{ itemId: string; newTags: string[] }>) => void;
  
  // Optional
  emptyMessage?: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function IndexView({
  items,
  title,
  description,
  createLabel = 'Create',
  onCreateClick,
  searchEnabled = true,
  searchPlaceholder = 'Search...',
  renderEditForm,
  onBulkUpdateItemTags,
  emptyMessage = 'No items yet. Create one to get started!'
}: IndexViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<IndexViewItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  
  // Selection mode state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [moveToPath, setMoveToPath] = useState('');

  // When searching, show all items that match (ignore folders)
  // When not searching, filter by current path
  const isSearching = searchQuery.trim().length > 0;
  
  const filteredItems = isSearching
    ? items.filter(item =>
        item.label.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : getItemsAtPath(items, currentPath);

  // Get folders at current path (only when not searching)
  const folders = isSearching ? [] : getFoldersAtPath(items, currentPath);

  // Get all existing folder paths for the shortcut buttons
  const existingFolders = Array.from(
    new Set(
      items.flatMap(item => 
        extractPathTags(item.tags).map(path => path)
      )
    )
  ).sort();

  // Clear selection when navigating or searching
  useEffect(() => {
    setSelectedItemIds(new Set());
  }, [currentPath, searchQuery]);

  const handleOpenEdit = (item: IndexViewItem) => {
    if (isSelectionMode) return; // Don't open edit in selection mode
    
    setIsCreating(false);
    setSelectedItem(item);
    openDrawer();
  };

  const handleOpenCreate = () => {
    if (!onCreateClick) return;
    setSelectedItem(null);
    setIsCreating(true);
    onCreateClick();
    openDrawer();
  };

  const handleFolderClick = (folder: FolderInfo) => {
    // Navigate into folder
    const newPath = folder.fullPath.split('/');
    setCurrentPath(newPath);
  };

  const handleBreadcrumbClick = (index: number) => {
    // Navigate to specific level
    // index -1 = root, 0 = first segment, etc.
    if (index === -1) {
      setCurrentPath([]);
    } else {
      setCurrentPath(currentPath.slice(0, index + 1));
    }
  };

  const handleToggleSelection = (itemId: string) => {
    const newSelected = new Set(selectedItemIds);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItemIds(newSelected);
  };

  const handleSelectAll = () => {
    const allItemIds = filteredItems.map(item => item.id);
    setSelectedItemIds(new Set(allItemIds));
  };

  const handleEnterSelectionMode = () => {
    setIsSelectionMode(true);
    setSelectedItemIds(new Set());
  };

  const handleExitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedItemIds(new Set());
    setMoveToPath('');
  };

  const handleMoveItems = () => {
    if (!onBulkUpdateItemTags) {
      console.warn('onBulkUpdateItemTags not provided to IndexView');
      return;
    }

    if (selectedItemIds.size === 0) {
      return;
    }

    const updates = Array.from(selectedItemIds).map(itemId => {
      const item = items.find(i => i.id === itemId);
      if (!item) return null;

      // Special case: empty = remove path tag entirely
      const trimmedPath = moveToPath.trim();
      let newTags: string[];
      
      if (trimmedPath === '') {
        newTags = removePathTag(item.tags); // Remove all path tags
      } else {
        // Case-sensitive folder paths
        const pathSegments = trimmedPath.split('/');
        newTags = replacePathTag(item.tags, pathSegments);
      }

      return {
        itemId: item.id,
        newTags
      };
    }).filter(update => update !== null) as Array<{ itemId: string; newTags: string[] }>;

    // Execute bulk update
    onBulkUpdateItemTags(updates);

    // Exit selection mode
    handleExitSelectionMode();
  };

  const openDrawer = () => {
    const checkbox = document.getElementById('indexview-drawer') as HTMLInputElement;
    if (checkbox) checkbox.checked = true;
  };

  return (
    <div className="drawer">
      <input 
        id="indexview-drawer" 
        type="checkbox" 
        className="drawer-toggle"
        onChange={(e) => {
          if (!e.target.checked) {
            setSelectedItem(null);
            setIsCreating(false);
          }
        }}
      />
      
      {/* Main Content */}
      <div className="drawer-content">
        <div className="space-y-4 p-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold">{title}</h2>
              {description && (
                <p className="text-base-content/60">{description}</p>
              )}
            </div>
            
            {/* Normal Mode Buttons */}
            {!isSelectionMode && (
              <div className="flex gap-2">
                {onBulkUpdateItemTags && (
                  <button 
                    onClick={handleEnterSelectionMode}
                    className="btn btn-outline"
                  >
                    <span className="icon-[mdi--checkbox-multiple-marked] w-5 h-5 mr-1" />
                    Select Items
                  </button>
                )}
                {/* Only show create button if onCreateClick is provided */}
                {onCreateClick && (
                  <button 
                    onClick={handleOpenCreate}
                    className="btn btn-primary"
                  >
                    <span className="icon-[mdi--plus] w-5 h-5 mr-1" />
                    {createLabel}
                  </button>
                )}
              </div>
            )}

            {/* Selection Mode Controls */}
            {isSelectionMode && (
              <div className="flex gap-2 items-center">
                <span className="text-sm font-medium">
                  {selectedItemIds.size} selected
                </span>
                
                {/* Move controls - only show if items are selected */}
                {selectedItemIds.size > 0 && (
                  <>
                    <div className="divider divider-horizontal mx-2"></div>
                    <span className="text-sm">Move to:</span>
                    <input
                      type="text"
                      value={moveToPath}
                      onChange={(e) => setMoveToPath(e.target.value)}
                      placeholder="root"
                      className="input input-bordered input-sm w-48"
                    />
                    
                    {/* Folder shortcuts dropdown */}
                    {existingFolders.length > 0 && (
                      <div className="dropdown">
                        <label tabIndex={0} className="btn btn-sm btn-ghost">
                          <span className="icon-[mdi--folder-outline] w-4 h-4" />
                        </label>
                        <ul tabIndex={0} className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 max-h-64 overflow-y-auto">
                          <li><a onClick={() => setMoveToPath('')}>Root</a></li>
                          {existingFolders.map(folder => (
                            <li key={folder}><a onClick={() => setMoveToPath(folder)}>{folder}</a></li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    <button
                      onClick={handleMoveItems}
                      className="btn btn-primary btn-sm"
                    >
                      <span className="icon-[mdi--arrow-right] w-4 h-4" />
                      Move
                    </button>
                  </>
                )}
                
                <div className="divider divider-horizontal mx-2"></div>
                <button
                  onClick={handleSelectAll}
                  className="btn btn-sm btn-primary"
                >
                  Select All
                </button>
                <button
                  onClick={handleExitSelectionMode}
                  className="btn btn-sm btn-neutral"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          

          {/* Breadcrumbs and Search Row */}
          <div className="flex gap-4 items-center">
            {/* Left side - Breadcrumbs or empty space */}
            <div className="flex-1">
              {!isSearching && currentPath.length > 0 && (
                <div className="breadcrumbs text-sm p-0">
                  <ul>
                    <li>
                      <button
                        onClick={() => handleBreadcrumbClick(-1)}
                        className="btn btn-ghost btn-sm"
                      >
                        <span className="icon-[mdi--home] w-4 h-4" />
                        Home
                      </button>
                    </li>
                    {currentPath.map((segment, index) => (
                      <li key={index}>
                        <button
                          onClick={() => handleBreadcrumbClick(index)}
                          className="btn btn-ghost btn-sm"
                        >
                          {segment}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Right side - Search */}
            {searchEnabled && (
              <div className="flex gap-2 w-96">
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input input-bordered flex-1"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="btn btn-ghost"
                    aria-label="Clear search"
                  >
                    <span className="icon-[mdi--close] w-5 h-5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Items or Empty State */}
          {folders.length === 0 && filteredItems.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-base-300 rounded-lg">
              <span className="icon-[f7--question-circle] w-16 h-16 opacity-30 inline-block mb-4"></span>
              <p className="text-xl mb-2">
                {searchQuery ? 'No items match your search' : emptyMessage}
              </p>
              {searchQuery && (
                <p className="text-base-content/60">Try a different search term</p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              {/* Render Folders First (only when not searching) */}
              {folders.map(folder => (
                <FolderCard
                  key={folder.fullPath}
                  folder={folder}
                  onClick={() => handleFolderClick(folder)}
                />
              ))}
              
              {/* Render Items */}
              {filteredItems.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onCardClick={() => handleOpenEdit(item)}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedItemIds.has(item.id)}
                  onToggleSelection={() => handleToggleSelection(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drawer */}
      <div className="drawer-side z-50">
        <label 
          htmlFor="indexview-drawer"
          aria-label="close sidebar"
          className="drawer-overlay"
        ></label>
        <div className="bg-base-200 min-h-full w-full max-w-4xl p-6 overflow-y-auto">
          {(selectedItem || isCreating) && renderEditForm(selectedItem, { currentPath })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// FOLDER CARD
// ============================================================================

interface FolderCardProps {
  folder: FolderInfo;
  onClick: () => void;
}

function FolderCard({ folder, onClick }: FolderCardProps) {
  return (
    <div
      onClick={onClick}
      className="card bg-base-100 border-2 border-base-300 hover:border-primary transition-colors w-64 cursor-pointer"
    >
      <figure className="px-4 pt-4">
        <div className="w-full aspect-square bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
          <span className="icon-[mdi--folder] w-24 h-24 text-primary"></span>
        </div>
      </figure>
      <div className="card-body p-4">
        <h3 className="card-title text-center justify-center">
          {folder.name}
        </h3>
        <div className="min-h-10 flex items-center justify-center">
          <p className="text-sm text-center text-base-content/60">
            Folder
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ITEM CARD
// ============================================================================

interface ItemCardProps {
  item: IndexViewItem;
  onCardClick: () => void;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelection: () => void;
}

function ItemCard({ item, onCardClick, isSelectionMode, isSelected, onToggleSelection }: ItemCardProps) {
  const handleCardClick = () => {
    if (isSelectionMode) {
      onToggleSelection();
    } else {
      onCardClick();
    }
  };

  return (
    <div className={`card bg-base-100 border-2 transition-colors w-64 ${
      isSelected ? 'border-primary ring-2 ring-primary' : 'hover:border-primary'
    }`}>
      {/* Card Body - Clickable */}
      <div
        onClick={handleCardClick}
        className="cursor-pointer relative"
      >
        {/* Checkbox overlay in selection mode */}
        {isSelectionMode && (
          <div className="absolute top-2 right-2 z-10">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelection}
              onClick={(e) => e.stopPropagation()}
              className="checkbox checkbox-primary checkbox-lg"
            />
          </div>
        )}

        <figure className="px-4 pt-4">
          {/* Square container with fixed aspect ratio */}
          <div className="w-full aspect-square bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
            {item.imageId ? (
              <ImageDisplay
                imageId={item.imageId}
                className="w-full h-full object-cover"
                alt={item.label}
              />
            ) : item.icon ? (
              <span 
                className={`${item.icon} w-24 h-24`}
                style={item.iconColor ? { color: item.iconColor } : undefined}
              />
            ) : (
              <span className="icon-[f7--question-circle] w-12 h-12 opacity-30"></span>
            )}
          </div>
        </figure>
        <div className="card-body p-2">
          <h3 className="card-title text-center justify-center">
            {item.label}
          </h3>
          {/* Fixed height with ellipsis, always takes space even if empty */}
          <div className="min-h-10">
            {item.details && (
              <p className="text-sm text-center line-clamp-2">
                {item.details}
              </p>
            )}
          </div>
        </div>
      </div>
      
      {/* Action Button - Hide in selection mode */}
      {!isSelectionMode && item.action && (
        <div className="card-actions justify-end p-4 pt-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              item.action!.onClick();
            }}
            disabled={item.action.disabled}
            className="btn btn-sm btn-primary w-full"
          >
            {item.action.icon && (
              <span className={`${item.action.icon} w-4 h-4 mr-1`} />
            )}
            {item.action.label}
          </button>
        </div>
      )}
    </div>
  );
}