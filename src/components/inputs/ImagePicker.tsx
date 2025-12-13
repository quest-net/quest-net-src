// components/inputs/ImagePicker.tsx

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";
import { ImageUpload } from "./ImageUpload";
import { ImageGenerator } from "./ImageGenerator";

interface ImagePickerProps {
	value?: string;
	onChange: (imageId: string | undefined) => void;
	readOnly?: boolean;
	generationContext?: {
		objectType?: string;
		name?: string;
		description?: string;
	};
}

export function ImagePicker({
	value,
	onChange,
	readOnly,
	generationContext,
}: ImagePickerProps) {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

	const [isOpen, setIsOpen] = useState(false);
	const [selectedImageId, setSelectedImageId] = useState<string | undefined>(
		value
	);
	const [searchQuery, setSearchQuery] = useState("");
	const [showUpload, setShowUpload] = useState(false);
	const [isHovered, setIsHovered] = useState(false);

	// Pagination
	const [page, setPage] = useState(1);
	const PAGE_SIZE = 12;

	const filteredImages = [...campaign.Images].reverse().filter((image) => {
		const matchesSearch = image.Name.toLowerCase().includes(
			searchQuery.toLowerCase()
		);

		// Permission filter - players only see their own uploads, DMs see everything
		const hasPermission =
			context.User.Role === "dm" || image.UploadedBy === context.User.Id;

		return matchesSearch && hasPermission;
	});

	const totalPages =
		filteredImages.length === 0
			? 1
			: Math.ceil(filteredImages.length / PAGE_SIZE);
	const currentPage = Math.min(page, totalPages);
	const startIndex = (currentPage - 1) * PAGE_SIZE;
	const pageItems = filteredImages.slice(
		startIndex,
		startIndex + PAGE_SIZE
	);

	const handlePrevPage = () => {
		setPage((prev) => Math.max(1, prev - 1));
	};

	const handleNextPage = () => {
		setPage((prev) => Math.min(totalPages, prev + 1));
	};

	const handleOpen = () => {
		if (readOnly) return;
		setSelectedImageId(value);
		setSearchQuery("");
		setShowUpload(false);
		setPage(1);
		setIsOpen(true);
	};

	const handleConfirm = () => {
		onChange(selectedImageId);
		setIsOpen(false);
	};

	const handleCancel = () => {
		setSelectedImageId(value);
		setIsOpen(false);
	};

	const handleClear = () => {
		setSelectedImageId(undefined);
	};

	const handleUploadComplete = (imageId: string | undefined) => {
		if (imageId) {
			setSelectedImageId(imageId);
			setShowUpload(false);
		}
	};

	// When AI generator selects an image, immediately apply it and close the picker
	const handleGeneratedSelect = (imageId: string) => {
		setSelectedImageId(imageId);
		onChange(imageId);
		setIsOpen(false);
	};

	// Create the modal content
	const modalContent = isOpen ? (
		<div className="modal modal-open">
			<div className="modal-box max-w-5xl max-h-[90vh] flex flex-col">
				{/* Header */}
				<div className="flex justify-between items-center mb-2">
					<h3 className="font-bold text-lg">Select Image</h3>
					<button
						onClick={handleCancel}
						className="btn btn-sm btn-circle btn-ghost"
					>
						✕
					</button>
				</div>

				{/* Upload Section */}
				{!showUpload ? (
					<button
						onClick={() => setShowUpload(true)}
						className="btn btn-primary btn-sm"
					>
						<span className="icon-[mdi--upload] w-4 h-4 mr-2" />
						Upload New Image
					</button>
				) : (
					<div className="p-4 border-2 border-primary rounded-lg">
						<div className="flex justify-between items-center mb-2">
							<h4 className="font-semibold">Upload New Image</h4>
							<button
								onClick={() => setShowUpload(false)}
								className="btn btn-ghost btn-xs"
							>
								Cancel
							</button>
						</div>
						<ImageUpload value={undefined} onChange={handleUploadComplete} />
					</div>
				)}

				{/* AI Generator */}
				<ImageGenerator
					contextInfo={generationContext}
					onSelectImage={handleGeneratedSelect}
				/>

				{/* Search */}
				<div className="flex gap-2 mb-2 mt-4">
					<input
						type="text"
						placeholder="Search images..."
						value={searchQuery}
						onChange={(e) => {
							setSearchQuery(e.target.value);
							setPage(1);
						}}
						className="input input-bordered input-sm flex-1"
					/>
					{searchQuery && (
						<button
							onClick={() => {
								setSearchQuery("");
								setPage(1);
							}}
							className="btn btn-ghost btn-sm"
						>
							<span className="icon-[mdi--close] w-4 h-4" />
						</button>
					)}
				</div>

				{/* Image Grid */}
				<div className="flex-1 overflow-y-auto p-2">
					{filteredImages.length === 0 ? (
						<div className="text-center py-12 border-2 border-dashed border-base-300 rounded-lg">
							<span className="icon-[mdi--image-off] w-12 h-12 opacity-30 inline-block mb-2"></span>
							<p className="text-sm">
								{searchQuery
									? "No images match your search"
									: "No images available"}
							</p>
						</div>
					) : (
						<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
							{pageItems.map((image) => (
								<div
									key={image.Id}
									onClick={() => setSelectedImageId(image.Id)}
									className={`
										card bg-base-100 border-2 cursor-pointer transition-all
										${selectedImageId === image.Id
											? "border-primary ring-2 ring-primary"
											: "border-base-300 hover:border-primary"
										}
									`}
								>
									<figure className="border-b">
										<div className="w-full h-32 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
											<ImageDisplay
												imageId={image.Id}
												className="w-full h-full object-contain"
												alt={image.Name}
											/>
										</div>
									</figure>
									<div className="card-body p-2">
										<h4
											className="text-xs font-semibold truncate"
											title={image.Name}
										>
											{image.Name}
										</h4>
										{selectedImageId === image.Id && (
											<div className="badge badge-primary badge-xs">
												Selected
											</div>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Footer Actions + Pagination */}
				<div className="mt-2 flex items-center justify-between gap-2">
					{/* Left: Clear */}
					<button
						onClick={handleClear}
						className="btn btn-neutral btn-sm"
						disabled={!selectedImageId}
					>
						Clear Selection
					</button>

					{/* Middle: Page controls */}
					{filteredImages.length > 0 && (
						<div className="flex flex-col items-center gap-1 text-xs">
							{totalPages > 1 && (
								<div className="join">
									<button
										type="button"
										className="btn btn-sm join-item"
										onClick={handlePrevPage}
										disabled={currentPage === 1}
									>
										«
									</button>
									<button
										type="button"
										className="btn btn-sm join-item pointer-events-none"
									>
										Page {currentPage} / {totalPages}
									</button>
									<button
										type="button"
										className="btn btn-sm join-item"
										onClick={handleNextPage}
										disabled={currentPage === totalPages}
									>
										»
									</button>
								</div>
							)}
						</div>
					)}

					{/* Right: Cancel / Confirm */}
					<div className="flex gap-2">
						<button onClick={handleCancel} className="btn btn-sm">
							Cancel
						</button>
						<button
							onClick={handleConfirm}
							className="btn btn-primary btn-sm"
							disabled={selectedImageId === value}
						>
							Confirm
						</button>
					</div>
				</div>
			</div>
			<div className="modal-backdrop" onClick={handleCancel}></div>
		</div>
	) : null;

	return (
		<div className="space-y-2 min-w-48">
			{/* Clickable Image Container */}
			<div
				onClick={handleOpen}
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
				className={`
					relative w-full h-48 bg-base-200 rounded-lg overflow-hidden 
					flex items-center justify-center
					${!readOnly ? "cursor-pointer" : ""}
					transition-opacity
					${!readOnly && isHovered ? "opacity-70" : "opacity-100"}
				`}
			>
				{value ? (
					<ImageDisplay
						imageId={value}
						className="w-full h-full object-contain"
						alt="Selected image"
					/>
				) : (
					<>
						<span
							className={`icon-[mdi--image-off] w-24 h-24 opacity-30 transition-opacity ${isHovered && !readOnly ? "opacity-0" : "opacity-30"
								}`}
						/>
						{isHovered && !readOnly && (
							<div className="absolute inset-0 flex items-center justify-center">
								<div className="btn btn-primary">
									<span className="icon-[mdi--image-plus] w-5 h-5 mr-2" />
									Choose Image
								</div>
							</div>
						)}
					</>
				)}
			</div>

			{/* Render modal via Portal */}
			{modalContent && createPortal(modalContent, document.body)}
		</div>
	);
}
