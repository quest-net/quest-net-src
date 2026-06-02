// components/CollectionView/CollectionView.tsx

import { useState, useEffect } from "react";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";
import { useIsMobile } from "../../hooks/useIsMobile";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";

// ============================================================================
// TYPES
// ============================================================================

export interface CollectionViewItem {
	id: string;
	label: string; // Main name/title
	details?: string; // Secondary info (e.g., "3/5 uses")
	description?: string; // Longer description text
	imageId?: string; // Image to display
	icon?: string; // Fallback icon if no image
	iconColor?: string; // Icon color
	badge?: string; // Small badge text (e.g., "∞", "2 turns")
	badgeColor?: string; // Badge color (DaisyUI classes: badge-primary, badge-success, etc.)
	actions?: CollectionAction[];
	onClick?: () => void; // Optional click handler for the item itself
}

interface CollectionAction {
	label: string;
	icon?: string;
	onClick: () => void;
	disabled?: boolean;
	variant?: "primary" | "secondary" | "error" | "ghost";
}

interface CollectionViewProps {
	items: CollectionViewItem[];
	title: string;
	description?: string;
	emptyMessage?: string;
	viewModeKey: string; // for localStorage (e.g., "inventory-view")
	searchEnabled?: boolean;
	searchPlaceholder?: string;
}

type ViewMode = "grid" | "list";
type SortOrder = "newest" | "oldest";

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function CollectionView({
	items,
	title,
	description,
	emptyMessage = "No items to display",
	viewModeKey,
	searchEnabled = false,
	searchPlaceholder = "Search...",
}: CollectionViewProps) {
	const isMobile = useIsMobile();
	const [searchQuery, setSearchQuery] = useState("");
	const [viewMode, setViewMode] = useState<ViewMode>(() => {
		try {
			return (localStorage.getItem(viewModeKey) as ViewMode) || "grid";
		} catch {
			return "grid";
		}
	});

	const sortKey = `${viewModeKey}-sort`;
	const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
		try {
			return (localStorage.getItem(sortKey) as SortOrder) || "newest";
		} catch {
			return "newest";
		}
	});

	// Persist view mode changes (best-effort; saveString handles its own errors)
	useEffect(() => {
		LocalStorageUtilities.saveString(viewModeKey, viewMode);
	}, [viewMode, viewModeKey]);

	// Persist sort order changes
	useEffect(() => {
		LocalStorageUtilities.saveString(sortKey, sortOrder);
	}, [sortOrder, sortKey]);

	// Filter items by search query
	const filteredItemsUnsorted = searchQuery.trim()
		? items.filter((item) =>
				item.label.toLowerCase().includes(searchQuery.toLowerCase())
		  )
		: items;

	// Apply sort order
	const filteredItems = sortOrder === "newest"
		? [...filteredItemsUnsorted].reverse()
		: filteredItemsUnsorted;

	// On mobile, always use list view regardless of stored preference.
	const effectiveViewMode: ViewMode = isMobile ? "list" : viewMode;

	// Format count text
	const countText = searchQuery.trim() && filteredItems.length !== items.length
		? `${filteredItems.length} of ${items.length} items`
		: `${items.length} ${items.length === 1 ? 'item' : 'items'}`;

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex justify-between items-center">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="text-2xl font-bold">{title}</h2>
						<span className="text-base-content/60">• {countText}</span>
					</div>
					{description && (
						<p className="text-base-content/60">{description}</p>
					)}
				</div>

				{/* View Mode Toggle + Sort Toggle */}
				<div className="flex gap-2">
					{/* Sort Order Toggle */}
					<button
						onClick={() => setSortOrder(sortOrder === "newest" ? "oldest" : "newest")}
						className="btn btn-sm btn-ghost tooltip tooltip-bottom"
						data-tip={sortOrder === "newest" ? "Newest first" : "Oldest first"}
						aria-label={`Sort: ${sortOrder === "newest" ? "Newest first" : "Oldest first"}`}
					>
						<span className={`${sortOrder === "newest" ? "icon-[mdi--sort-descending]" : "icon-[mdi--sort-ascending]"} w-5 h-5`} />
					</button>

					{!isMobile && (
						<>
							<button
								onClick={() => setViewMode("grid")}
								className={`btn btn-sm ${viewMode === "grid" ? "btn-primary" : "btn-ghost"}`}
								title="Grid view"
							>
								<span className="icon-[mdi--grid] w-5 h-5" />
							</button>
							<button
								onClick={() => setViewMode("list")}
								className={`btn btn-sm ${viewMode === "list" ? "btn-primary" : "btn-ghost"}`}
								title="List view"
							>
								<span className="icon-[mdi--view-list] w-5 h-5" />
							</button>
						</>
					)}
				</div>
			</div>
			{/* Search */}
			{searchEnabled && (
				<div className="flex gap-2">
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

			{/* Content */}
			{filteredItems.length === 0 ? (
				<div className="text-center py-12 border-2 border-dashed border-base-300 rounded-lg">
					<span className="icon-[mdi--help-circle-outline] w-16 h-16 opacity-30 inline-block mb-4"></span>
					<p className="text-xl mb-2">
						{searchQuery ? "No items match your search" : emptyMessage}
					</p>
					{searchQuery && (
						<p className="text-base-content/60">Try a different search term</p>
					)}
				</div>
			) : effectiveViewMode === "grid" ? (
				<div className="flex flex-wrap gap-4 justify-between">
					{filteredItems.map((item) => (
						<CollectionCard key={item.id} item={item} />
					))}
					{/* Ghost divs to align last row left */}
					{[...Array(10)].map((_, i) => (
						<div key={`ghost-${i}`} className="w-64" aria-hidden="true" />
					))}
				</div>
			) : (
				<div className="space-y-2">
					{filteredItems.map((item) => (
						<CollectionRow key={item.id} item={item} />
					))}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// COLLECTION CARD (Grid View)
// ============================================================================

interface CollectionCardProps {
	item: CollectionViewItem;
}

function CollectionCard({ item }: CollectionCardProps) {
	const handleCardClick = (e: React.MouseEvent) => {
		// Don't trigger if clicking on action buttons
		if ((e.target as HTMLElement).closest("button")) {
			return;
		}
		item.onClick?.();
	};

	return (
		<div
			className={`card bg-base-100 border-2 border-base-300 w-64 ${
				item.onClick ? "cursor-pointer hover:border-primary transition-colors" : ""
			}`}
			onClick={item.onClick ? handleCardClick : undefined}
		>
			<figure className="px-4 pt-4 relative">
				{/* Badge in top-right corner */}
				{item.badge && (
					<div className="absolute top-2 right-2 z-10">
						<span
							className={`badge ${item.badgeColor || "badge-neutral"} badge-sm`}
						>
							{item.badge}
						</span>
					</div>
				)}

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
						<span className="icon-[mdi--help-circle-outline] w-12 h-12 opacity-30"></span>
					)}
				</div>
			</figure>

			<div className="px-4 py-1">
				<h3 className="card-title text-center justify-center text-base">
					{item.label}
				</h3>

				{/* Details */}
				{item.details && (
					<p className="text-md text-center">{item.details}</p>
				)}

				{/* Description - fixed height with ellipsis */}
				<div className="min-h-10">
					{item.description && (
						<p className="text-sm text-center line-clamp-2 opacity-60">
							{item.description}
						</p>
					)}
				</div>

				{/* Actions */}
				{item.actions && item.actions.length > 0 && (
					<div className="card-actions justify-center flex-col gap-2 mt-2">
						{item.actions.map((action, index) => (
							<button
								key={index}
								onClick={(e) => {
									e.stopPropagation();
									action.onClick();
								}}
								disabled={action.disabled}
								className={`btn btn-sm w-full ${
									action.variant === "primary"
										? "btn-primary"
										: action.variant === "secondary"
										? "btn-secondary"
										: action.variant === "error"
										? "btn-error"
										: "btn-ghost"
								}`}
							>
								{action.icon && (
									<span className={`${action.icon} w-4 h-4 mr-1`} />
								)}
								{action.label}
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// COLLECTION ROW (List View)
// ============================================================================

interface CollectionRowProps {
	item: CollectionViewItem;
}

function CollectionRow({ item }: CollectionRowProps) {
	const handleRowClick = (e: React.MouseEvent) => {
		// Don't trigger if clicking on action buttons
		if ((e.target as HTMLElement).closest("button")) {
			return;
		}
		item.onClick?.();
	};

	return (
		<div
			className={`card card-side bg-base-100 border-2 border-base-300 p-4 ${
				item.onClick ? "cursor-pointer hover:border-primary transition-colors" : ""
			}`}
			onClick={item.onClick ? handleRowClick : undefined}
		>
			<div className="flex gap-4 flex-1 items-center">
				{/* Image/Icon */}
				<div className="w-32 h-32 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center shrink-0">
					{item.imageId ? (
						<ImageDisplay
							imageId={item.imageId}
							className="w-full h-full object-cover"
							alt={item.label}
						/>
					) : item.icon ? (
						<span
							className={`${item.icon} w-12 h-12`}
							style={item.iconColor ? { color: item.iconColor } : undefined}
						/>
					) : (
						<span className="icon-[mdi--help-circle-outline] w-8 h-8 opacity-30"></span>
					)}
				</div>

				{/* Content */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-1">
						<h3 className="font-bold text-lg">{item.label}</h3>
						{item.badge && (
							<span
								className={`badge ${item.badgeColor || "badge-neutral"} badge-sm`}
							>
								{item.badge}
							</span>
						)}
					</div>

					{item.details && (
						<p className="text-sm opacity-70 mb-1">{item.details}</p>
					)}

					{item.description && (
						<p className="text-sm opacity-60 line-clamp-2">
							{item.description}
						</p>
					)}
				</div>

				{/* Actions */}
				{item.actions && item.actions.length > 0 && (
					<div className="flex gap-2 shrink-0">
						{item.actions.map((action, index) => (
							<button
								key={index}
								onClick={(e) => {
									e.stopPropagation();
									action.onClick();
								}}
								disabled={action.disabled}
								className={`btn btn-sm ${
									action.variant === "primary"
										? "btn-primary"
										: action.variant === "secondary"
										? "btn-secondary"
										: action.variant === "error"
										? "btn-error"
										: "btn-ghost"
								}`}
								title={action.label}
							>
								{action.icon && (
									<span className={`${action.icon} w-4 h-4`} />
								)}
								<span className="hidden sm:inline ml-1">{action.label}</span>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}