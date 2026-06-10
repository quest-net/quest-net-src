// components/IndexView/IndexView.tsx

import { useState, ReactNode, useEffect } from "react";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";
import { EmptyState } from "../ui/EmptyState";
import {
	getFoldersAtPath,
	getItemsAtPath,
	replacePathTag,
	removePathTag,
	FolderInfo,
	extractPathTags,
} from "../../utils/FolderUtils";

// ============================================================================
// TYPES
// ============================================================================

type SortOrder = "newest" | "oldest";

export interface IndexViewItem {
	id: string;
	label: string;
	details?: string;
	imageId?: string;
	icon?: string;
	iconColor?: string;
	tags?: string[];
	action?: {
		label: string;
		icon?: string;
		onClick: () => void;
		disabled?: boolean;
	};
}

export interface SelectionAction {
	label: string;
	icon?: string;
	onClick?: (selectedIds: string[]) => void;
	variant?: "primary" | "secondary" | "error" | "ghost";
	requiresSelection?: boolean; // If true, disabled when nothing selected
	/**
	 * When provided, the action button becomes a dropdown toggle and this
	 * renders the floating menu content. `close` collapses the dropdown. Use
	 * for actions that need a secondary choice (e.g. picking a target user).
	 */
	renderDropdown?: (selectedIds: string[], close: () => void) => ReactNode;
}

interface IndexViewProps {
	// Data
	items: IndexViewItem[];

	// Header
	title: string;
	description?: string;
	createLabel?: string;
	onCreateClick?: () => void;
	extraButtons?: ReactNode;

	// Features
	searchEnabled?: boolean;
	searchPlaceholder?: string;
	sortKey?: string; // localStorage key for sort order persistence (e.g., "items-sort")

	// Pagination
	itemsPerPage?: number; // Default: 20

	// Drawer content
	renderEditForm: (
		item: IndexViewItem | null,
		context: { currentPath: string[]; closeDrawer: () => void }
	) => ReactNode;

	/**
	 * When true, the edit drawer expands to fill the screen instead of being
	 * capped at max-w-4xl. Use for domains that need a full-page editor layout
	 * (e.g. terrain editor + live preview).
	 */
	editFormFullWidth?: boolean;

	// Folder support - callback for bulk tag updates
	onBulkUpdateItemTags?: (
		updates: Array<{ itemId: string; newTags: string[] }>
	) => void;

	// Selection actions - custom actions to perform on selected items
	selectionActions?: SelectionAction[];

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
	createLabel = "Create",
	onCreateClick,
	extraButtons,
	searchEnabled = true,
	searchPlaceholder = "Search...",
	sortKey,
	itemsPerPage = 25,
	renderEditForm,
	editFormFullWidth = false,
	onBulkUpdateItemTags,
	selectionActions = [],
	emptyMessage = "No items yet. Create one to get started!",
}: IndexViewProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedItem, setSelectedItem] = useState<IndexViewItem | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const [currentPath, setCurrentPath] = useState<string[]>([]);
	const [isDrawerOpen, setDrawerOpen] = useState(false);

	// Selection mode state
	const [isSelectionMode, setIsSelectionMode] = useState(false);
	const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
		new Set()
	);
	const [moveToPath, setMoveToPath] = useState("");

	// Pagination state
	const [currentPage, setCurrentPage] = useState(1);

	// Sort order state (persisted to localStorage if sortKey provided)
	const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
		if (sortKey) {
			try {
				return (localStorage.getItem(sortKey) as SortOrder) || "newest";
			} catch {
				return "newest";
			}
		}
		return "newest";
	});

	// Persist sort order changes (best-effort; saveString handles its own errors)
	useEffect(() => {
		if (sortKey) {
			LocalStorageUtilities.saveString(sortKey, sortOrder);
		}
	}, [sortOrder, sortKey]);

	// When searching, show all items that match (ignore folders)
	// When not searching, filter by current path
	const isSearching = searchQuery.trim().length > 0;

	const filteredItemsUnsorted = isSearching
		? items.filter((item) =>
				item.label.toLowerCase().includes(searchQuery.toLowerCase())
		  )
		: getItemsAtPath(items, currentPath);

	// Apply sort order
	const filteredItems = sortOrder === "newest"
		? [...filteredItemsUnsorted].reverse()
		: filteredItemsUnsorted;

	// Get folders at current path (only when not searching)
	const folders = isSearching ? [] : getFoldersAtPath(items, currentPath);

	// Get all existing folder paths for the shortcut buttons
	const existingFolders = Array.from(
		new Set(
			items.flatMap((item) => extractPathTags(item.tags).map((path) => path))
		)
	).sort();

	// Combine folders and items for unified pagination
	type DisplayEntry = 
		| { type: 'folder'; data: FolderInfo }
		| { type: 'item'; data: IndexViewItem };

	const combinedEntries: DisplayEntry[] = [
		...folders.map(f => ({ type: 'folder' as const, data: f })),
		...filteredItems.map(i => ({ type: 'item' as const, data: i }))
	];

	// Calculate pagination on combined entries
	const totalPages = Math.ceil(combinedEntries.length / itemsPerPage);
	const startIdx = (currentPage - 1) * itemsPerPage;
	const paginatedEntries = combinedEntries.slice(startIdx, startIdx + itemsPerPage);

	// Reset to page 1 when navigating or searching
	useEffect(() => {
		setCurrentPage(1);
		setSelectedItemIds(new Set());
	}, [currentPath, searchQuery]);

	// Drawer controls (React-controlled)
	const openDrawer = () => setDrawerOpen(true);
	const closeDrawer = () => {
		setDrawerOpen(false);
		setSelectedItem(null);
		setIsCreating(false);
	};

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
		const newPath = folder.fullPath.split("/");
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

	// Select all filtered items (across all pages)
	const handleSelectAll = () => {
		const allItemIds = filteredItems.map((item) => item.id);
		setSelectedItemIds(new Set(allItemIds));
	};

	const handleEnterSelectionMode = () => {
		setIsSelectionMode(true);
		setSelectedItemIds(new Set());
	};

	const handleExitSelectionMode = () => {
		setIsSelectionMode(false);
		setSelectedItemIds(new Set());
		setMoveToPath("");
	};

	const handleMoveItems = () => {
		if (!onBulkUpdateItemTags) {
			console.warn("onBulkUpdateItemTags not provided to IndexView");
			return;
		}

		if (selectedItemIds.size === 0) {
			return;
		}

		const updates = Array.from(selectedItemIds)
			.map((itemId) => {
				const item = items.find((i) => i.id === itemId);
				if (!item) return null;

				// Special case: empty = remove path tag entirely
				const trimmedPath = moveToPath.trim();
				let newTags: string[];

				if (trimmedPath === "") {
					newTags = removePathTag(item.tags); // Remove all path tags
				} else {
					// Case-sensitive folder paths
					const pathSegments = trimmedPath.split("/");
					newTags = replacePathTag(item.tags, pathSegments);
				}

				return {
					itemId: item.id,
					newTags,
				};
			})
			.filter((update) => update !== null) as Array<{
			itemId: string;
			newTags: string[];
		}>;

		// Execute bulk update
		onBulkUpdateItemTags(updates);

		// Exit selection mode
		handleExitSelectionMode();
	};

	const handleSelectionAction = (action: SelectionAction) => {
		const selectedIds = Array.from(selectedItemIds);
		action.onClick?.(selectedIds);
		// Note: Don't automatically exit selection mode - let the action handler decide
	};

	// Pagination handlers
	const handlePrevPage = () => {
		setCurrentPage((prev) => Math.max(1, prev - 1));
	};

	const handleNextPage = () => {
		setCurrentPage((prev) => Math.min(totalPages, prev + 1));
	};

	// Check if we have folder management available
	const hasFolderManagement = !!onBulkUpdateItemTags;
	
	// Check if we have any selection features (folder management OR custom actions)
	const hasSelectionFeatures = hasFolderManagement || selectionActions.length > 0;

	return (
		<div className="drawer">
			<input
				id="indexview-drawer"
				type="checkbox"
				className="drawer-toggle"
				checked={isDrawerOpen}
				onChange={(e) => {
					const open = e.target.checked;
					setDrawerOpen(open);
					if (!open) {
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
								<p className="opacity-70">{description}</p>
							)}
						</div>

						{/* Normal Mode Buttons */}
						{!isSelectionMode && (
							<div className="flex gap-2">
								{/* Extra buttons slot */}
								{extraButtons}
								
								{hasSelectionFeatures && (
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
							<div className="flex gap-2 items-center flex-wrap">
								<span className="text-sm font-medium">
									{selectedItemIds.size} selected
									{selectedItemIds.size > 0 && totalPages > 1 && (
										<span className="text-xs opacity-70 ml-1">
											(across all pages)
										</span>
									)}
								</span>

								{/* Custom Selection Actions */}
								{selectionActions.length > 0 && (
									<>
										<div className="divider divider-horizontal mx-2"></div>
										{selectionActions.map((action, index) => {
											const isDisabled =
												!!action.requiresSelection &&
												selectedItemIds.size === 0;

											const btnClassName = `btn btn-sm ${
												action.variant === "primary"
													? "btn-primary"
													: action.variant === "secondary"
													? "btn-secondary"
													: action.variant === "error"
													? "btn-error"
													: "btn-ghost"
											}`;

											const btnInner = (
												<>
													{action.icon && (
														<span className={`${action.icon} w-4 h-4`} />
													)}
													{action.label}
												</>
											);

											// Dropdown variant: toggle reveals caller-rendered menu.
											if (action.renderDropdown && !isDisabled) {
												return (
													<div key={index} className="dropdown dropdown-end">
														<label tabIndex={0} className={btnClassName}>
															{btnInner}
														</label>
														<div
															tabIndex={0}
															className="dropdown-content z-50 mt-1"
														>
															{action.renderDropdown(
																Array.from(selectedItemIds),
																() =>
																	(
																		document.activeElement as HTMLElement | null
																	)?.blur()
															)}
														</div>
													</div>
												);
											}

											return (
												<button
													key={index}
													onClick={() => handleSelectionAction(action)}
													disabled={isDisabled}
													className={btnClassName}
												>
													{btnInner}
												</button>
											);
										})}
									</>
								)}

								{/* Folder Move controls - only show if folder management is enabled and items are selected */}
								{hasFolderManagement && selectedItemIds.size > 0 && (
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
												<ul
													tabIndex={0}
													className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 max-h-64 overflow-y-auto"
												>
													<li>
														<a onClick={() => setMoveToPath("")}>Root</a>
													</li>
													{existingFolders.map((folder) => (
														<li key={folder}>
															<a onClick={() => setMoveToPath(folder)}>
																{folder}
															</a>
														</li>
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

						{/* Right side - Sort Toggle + Search */}
						<div className="flex gap-2 items-center">
							{/* Sort Order Toggle */}
							<button
								onClick={() => setSortOrder(sortOrder === "newest" ? "oldest" : "newest")}
								className="btn btn-ghost btn-sm tooltip tooltip-bottom"
								data-tip={sortOrder === "newest" ? "Newest first" : "Oldest first"}
								aria-label={`Sort: ${sortOrder === "newest" ? "Newest first" : "Oldest first"}`}
							>
								<span className={`${sortOrder === "newest" ? "icon-[mdi--sort-descending]" : "icon-[mdi--sort-ascending]"} w-5 h-5`} />
							</button>

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
										onClick={() => setSearchQuery("")}
										className="btn btn-ghost"
										aria-label="Clear search"
									>
										<span className="icon-[mdi--close] w-5 h-5" />
									</button>
								)}
							</div>
						)}
						</div>
					</div>

					{/* Items or Empty State */}
					{combinedEntries.length === 0 ? (
						<EmptyState bordered icon="icon-[mdi--help-circle-outline]">
							<p>{searchQuery ? "No items match your search" : emptyMessage}</p>
							{searchQuery && <p>Try a different search term</p>}
						</EmptyState>
					) : (
						<>
							<div className="flex flex-wrap gap-4 justify-between">
								{/* Render paginated entries (folders and items together) */}
								{paginatedEntries.map((entry) => {
									if (entry.type === 'folder') {
										return (
											<FolderCard
												key={entry.data.fullPath}
												folder={entry.data}
												onClick={() => handleFolderClick(entry.data)}
											/>
										);
									} else {
										return (
											<ItemCard
												key={entry.data.id}
												item={entry.data}
												onCardClick={() => handleOpenEdit(entry.data)}
												isSelectionMode={isSelectionMode}
												isSelected={selectedItemIds.has(entry.data.id)}
												onToggleSelection={() => handleToggleSelection(entry.data.id)}
											/>
										);
									}
								})}

								{/* Ghost divs to align last row left */}
								{[...Array(10)].map((_, i) => (
									<div key={`ghost-${i}`} className="w-64" aria-hidden="true" />
								))}
							</div>

							{/* Pagination Controls */}
							{totalPages > 1 && (
								<div className="flex justify-center items-center gap-4 pt-4 pb-2">
									<button
										onClick={handlePrevPage}
										disabled={currentPage === 1}
										className="btn btn-sm btn-ghost"
										aria-label="Previous page"
									>
										<span className="icon-[mdi--chevron-left] w-5 h-5" />
										Prev
									</button>

									<span className="text-sm">
										Page {currentPage} of {totalPages}
									</span>

									<button
										onClick={handleNextPage}
										disabled={currentPage === totalPages}
										className="btn btn-sm btn-ghost"
										aria-label="Next page"
									>
										Next
										<span className="icon-[mdi--chevron-right] w-5 h-5" />
									</button>
								</div>
							)}
						</>
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
				<div
					className={`bg-base-200 min-h-full w-full p-6 overflow-y-auto ${
						editFormFullWidth ? "" : "max-w-4xl"
					}`}
				>
					{(selectedItem || isCreating) &&
						renderEditForm(selectedItem, { currentPath, closeDrawer })}
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
				<h3 className="card-title text-center justify-center">{folder.name}</h3>
				<div className="min-h-10 flex items-center justify-center">
					<p className="text-sm text-center opacity-70">Folder</p>
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

function ItemCard({
	item,
	onCardClick,
	isSelectionMode,
	isSelected,
	onToggleSelection,
}: ItemCardProps) {
	const handleCardClick = () => {
		if (isSelectionMode) {
			onToggleSelection();
		} else {
			onCardClick();
		}
	};

	return (
		<div
			className={`card bg-base-100 border-2 transition-colors w-64 ${
				isSelected
					? "border-primary ring-2 ring-primary"
					: "hover:border-primary"
			}`}
		>
			{/* Card Body - Clickable */}
			<div onClick={handleCardClick} className="cursor-pointer relative">
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
								style={{ overflowClipMargin: "unset" }}
								alt={item.label}
							/>
						) : item.icon ? (
							<span
								className={`${item.icon} w-24 h-24`}
								style={item.iconColor ? { color: item.iconColor } : undefined}
							/>
						) : (
							<span className="icon-[mdi--help-circle-outline] w-12 h-12 opacity-70"></span>
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
							<p className="text-sm text-center line-clamp-2">{item.details}</p>
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