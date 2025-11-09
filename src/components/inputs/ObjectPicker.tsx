// components/inputs/ObjectPicker.tsx

import { useState, useMemo } from "react";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";

// Generic interface for pickable objects
export interface PickableObject {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;
	Tags?: string[];
}

// Configuration for each object type
export interface ObjectTypeConfig<T extends PickableObject> {
	label: string; // "Items", "Skills", "Statuses"
	items: T[]; // The actual collection
	icon?: string; // Icon class (e.g., "icon-[mdi--bag-personal]")
	typeKey: string; // "item", "skill", "status" - for action dispatch
}

interface ObjectPickerProps {
	isOpen: boolean;
	types: ObjectTypeConfig<any>[]; // Array of object types to choose from
	defaultTypeIndex?: number; // Index of default type (0 = first)
	multiSelect?: boolean; // Allow selecting multiple objects
	selectedIds?: string[]; // Currently selected IDs
	showCount?: boolean; // Show count input
	onConfirm: (selectedIds: string[], objectType: string, count: number) => void;
	onCancel: () => void;
	title?: string; // Optional custom title
}

const ITEMS_PER_PAGE = 12;

export function ObjectPicker({
	isOpen,
	types,
	defaultTypeIndex = 0,
	multiSelect = false,
	selectedIds = [],
	showCount = false,
	onConfirm,
	onCancel,
	title = "Select Objects",
}: ObjectPickerProps) {
	const [activeTypeIndex, setActiveTypeIndex] = useState(defaultTypeIndex);
	const [searchQuery, setSearchQuery] = useState("");
	const [currentPage, setCurrentPage] = useState(0);
	const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(selectedIds);
	const [count, setCount] = useState(1);

	// Get current object type
	const currentType = types[activeTypeIndex];
	if (!currentType) {
		console.error("No object types provided to ObjectPicker");
		return null;
	}

	// Filter items based on search
	const filteredItems = useMemo(() => {
		if (!searchQuery.trim()) return currentType.items;

		const query = searchQuery.toLowerCase();
		return currentType.items.filter(
			(item: PickableObject) =>
				item.Name.toLowerCase().includes(query) ||
				item.Description?.toLowerCase().includes(query) ||
				item.Tags?.some((tag) => tag.toLowerCase().includes(query))
		);
	}, [currentType.items, searchQuery]);

	// Pagination
	const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
	const paginatedItems = useMemo(() => {
		const start = currentPage * ITEMS_PER_PAGE;
		return filteredItems.slice(start, start + ITEMS_PER_PAGE);
	}, [filteredItems, currentPage]);

	// Reset page when switching types or searching
	const handleTypeChange = (index: number) => {
		setActiveTypeIndex(index);
		setCurrentPage(0);
		setSearchQuery("");
		setLocalSelectedIds([]); // Clear selection when switching types
	};

	const handleSearchChange = (query: string) => {
		setSearchQuery(query);
		setCurrentPage(0);
	};

	const handleToggleSelect = (id: string) => {
		if (multiSelect) {
			setLocalSelectedIds((prev) =>
				prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
			);
		} else {
			setLocalSelectedIds([id]);
		}
	};

	const handleConfirm = () => {
		onConfirm(localSelectedIds, currentType.typeKey, count);
		setLocalSelectedIds([]);
		setSearchQuery("");
		setCurrentPage(0);
		setCount(1);
	};

	const handleCancel = () => {
		setLocalSelectedIds(selectedIds);
		setSearchQuery("");
		setCurrentPage(0);
		setCount(1);
		onCancel();
	};

	const handleClear = () => {
		setLocalSelectedIds([]);
	};

	if (!isOpen) return null;

	return (
		<div className="modal modal-open">
			<div className="modal-box max-w-5xl max-h-[90vh] flex flex-col">
				{/* Header */}
				<div className="flex justify-between items-center mb-4">
					<h3 className="font-bold text-lg">{title}</h3>
					<button
						onClick={handleCancel}
						className="btn btn-sm btn-circle btn-ghost"
					>
						✕
					</button>
				</div>

				{/* Type Tabs */}
				{types.length > 1 && (
					<div className="tabs tabs-boxed mb-4">
						{types.map((type, index) => (
							<button
								key={index}
								className={`tab gap-2 ${
									index === activeTypeIndex ? "tab-active" : ""
								}`}
								onClick={() => handleTypeChange(index)}
							>
								{type.icon && <span className={`${type.icon} w-4 h-4`} />}
								{type.label}
							</button>
						))}
					</div>
				)}

				{/* Search Bar */}
				<div className="flex gap-2 mb-4">
					<input
						type="text"
						placeholder={`Search ${currentType.label.toLowerCase()}...`}
						value={searchQuery}
						onChange={(e) => handleSearchChange(e.target.value)}
						className="input input-bordered input-sm flex-1"
					/>
					{searchQuery && (
						<button
							onClick={() => handleSearchChange("")}
							className="btn btn-ghost btn-sm"
						>
							<span className="icon-[mdi--close] w-4 h-4" />
						</button>
					)}
				</div>

				{/* Selection Count and Count Input */}
				<div className="flex justify-between items-center mb-2">
					{multiSelect && localSelectedIds.length > 0 && (
						<div className="text-sm opacity-70">
							{localSelectedIds.length} selected
						</div>
					)}
					{!multiSelect && <div></div>}
					
					{showCount && localSelectedIds.length > 0 && (
						<div className="flex items-center gap-2">
							<label className="text-sm font-medium">Count:</label>
							<input
								type="number"
								min={1}
								max={99}
								value={count}
								onChange={(e) => setCount(Math.max(1, Math.min(99, Number(e.target.value))))}
								className="input input-bordered input-sm w-20"
							/>
						</div>
					)}
				</div>

				{/* Object Grid */}
				<div className="flex-1 overflow-y-auto p-2">
					{paginatedItems.length === 0 ? (
						<div className="text-center py-12 border-2 border-dashed border-base-300 rounded-lg">
							<span className="icon-[mdi--package-variant] w-12 h-12 opacity-30 inline-block mb-2" />
							<p className="text-sm">
								{searchQuery
									? `No ${currentType.label.toLowerCase()} match your search`
									: `No ${currentType.label.toLowerCase()} available`}
							</p>
						</div>
					) : (
						<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
							{paginatedItems.map((item: PickableObject) => {
								const isSelected = localSelectedIds.includes(item.Id);

								return (
									<div
										key={item.Id}
										onClick={() => handleToggleSelect(item.Id)}
										className={`
											card bg-base-100 border-2 cursor-pointer transition-all
											${
												isSelected
													? "border-primary ring-2 ring-primary"
													: "border-base-300 hover:border-primary"
											}
										`}
									>
										<figure className="px-2 pt-2">
											<div className="w-full h-32 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
												{item.Image ? (
													<ImageDisplay
														imageId={item.Image}
														className="w-full h-full object-contain"
														alt={item.Name}
													/>
												) : (
													<span className="icon-[mdi--package-variant] w-12 h-12 opacity-30" />
												)}
											</div>
										</figure>
										<div className="card-body p-2">
											<h4
												className="text-xs font-semibold truncate"
												title={item.Name}
											>
												{item.Name}
											</h4>
											{item.Description && (
												<p className="text-xs opacity-70 line-clamp-2">
													{item.Description}
												</p>
											)}
											{isSelected && (
												<div className="badge badge-primary badge-xs mt-1">
													Selected
												</div>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Pagination */}
				{totalPages > 1 && (
					<div className="flex justify-center items-center gap-2 mb-4">
						<button
							onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
							disabled={currentPage === 0}
							className="btn btn-sm"
						>
							<span className="icon-[mdi--chevron-left] w-4 h-4" />
						</button>
						<span className="text-sm">
							Page {currentPage + 1} of {totalPages}
						</span>
						<button
							onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
							disabled={currentPage === totalPages - 1}
							className="btn btn-sm"
						>
							<span className="icon-[mdi--chevron-right] w-4 h-4" />
						</button>
					</div>
				)}

				{/* Footer Actions */}
				<div className="flex justify-between items-center">
					<button
						onClick={handleClear}
						className="btn btn-neutral btn-sm"
						disabled={localSelectedIds.length === 0}
					>
						Clear Selection
					</button>
					<div className="flex gap-2">
						<button onClick={handleCancel} className="btn btn-sm">
							Cancel
						</button>
						<button
							onClick={handleConfirm}
							className="btn btn-primary btn-sm"
							disabled={localSelectedIds.length === 0}
						>
							Confirm
							{localSelectedIds.length > 0 && ` (${localSelectedIds.length})`}
						</button>
					</div>
				</div>
			</div>
			<div className="modal-backdrop" onClick={handleCancel} />
		</div>
	);
}