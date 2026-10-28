// components/pickers/ImagePicker.tsx

import { useState } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";
import { ImageUpload } from "../editors/ImageUpload";
import { ImageGenerator } from "../editors/ImageGenerator";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/EmptyState";

interface ImagePickerProps {
	value?: string;
	onChange: (imageId: string | undefined) => void;
	readOnly?: boolean;
	/**
	 * Show the chosen image at its own aspect ratio, up to 24rem tall, instead
	 * of letterboxed in the fixed 12rem box (for full character art).
	 */
	tall?: boolean;
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
	tall = false,
	generationContext,
}: ImagePickerProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const [isOpen, setIsOpen] = useState(false);
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
		setSearchQuery("");
		setShowUpload(false);
		setPage(1);
		setIsOpen(true);
	};

	// Single choice: picking (clicking, uploading, generating, removing) applies at once and closes.
	const handlePick = (imageId: string | undefined) => {
		onChange(imageId);
		setIsOpen(false);
	};

	const handleCancel = () => {
		setIsOpen(false);
	};

	const handleUploadComplete = (imageId: string | undefined) => {
		if (imageId) handlePick(imageId);
	};

	// Create the modal content
	const modalContent = isOpen ? (
		<Modal title="Select Image" onClose={handleCancel} size="xl" fullHeight>
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
					onSelectImage={handlePick}
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
						<EmptyState bordered icon="icon-[mdi--image-off]">
							{searchQuery
								? "No images match your search"
								: "No images available"}
						</EmptyState>
					) : (
						<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
							{pageItems.map((image) => (
								<div
									key={image.Id}
									onClick={() => handlePick(image.Id)}
									className={`
										card bg-base-100 border-2 cursor-pointer transition-all
										${value === image.Id
											? "border-primary ring-2 ring-primary"
											: "border-base-300 hover:border-primary"
										}
									`}
								>
									<figure className="border-b">
										<div className="w-full h-32 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
											<ImageDisplay
												imageId={image.Id}
												className="w-full h-full object-cover object-top"
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
										{value === image.Id && (
											<div className="badge badge-primary badge-xs">
												Current
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
					{/* Left: Remove */}
					<button
						onClick={() => handlePick(undefined)}
						className="btn btn-ghost btn-sm"
						disabled={!value}
					>
						Remove Image
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

					{/* Right: Cancel */}
					<button onClick={handleCancel} className="btn btn-neutral btn-sm">
						Cancel
					</button>
				</div>
		</Modal>
	) : null;

	// Tall mode sizes the button to the image itself (no letterbox bars); an
	// empty slot still uses the standard box so there's something to click.
	const natural = tall && !!value;

	return (
		<div className={`space-y-2 ${tall ? "" : "min-w-48"}`}>
			{/* Clickable Image Container */}
			<button
				type="button"
				onClick={handleOpen}
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
				disabled={readOnly}
				aria-label={value ? "Change selected image" : "Choose image"}
				className={`
					relative rounded-lg overflow-hidden
					${natural ? "block mx-auto max-w-full" : `${tall ? "w-48 max-w-full" : "w-full"} h-48 bg-base-200 flex items-center justify-center`}
					appearance-none border-0 p-0 text-inherit
					${!readOnly ? "cursor-pointer" : "cursor-default"}
					transition-all
					${!readOnly && isHovered ? "brightness-90" : ""}
				`}
			>
				{value ? (
					<ImageDisplay
						imageId={value}
						className={natural ? "block max-h-96 max-w-full w-auto" : "w-full h-full object-contain"}
						alt="Selected image"
					/>
				) : (
					// Always say the slot is clickable, not only on hover.
					<div className="flex flex-col items-center gap-2 opacity-70">
						<span
							className={`${readOnly ? "icon-[mdi--image-off]" : "icon-[mdi--image-plus]"} w-16 h-16`}
						/>
						{!readOnly && <span className="text-sm font-medium">Choose image</span>}
					</div>
				)}
			</button>

			{/* Modal portals itself to <body> */}
			{modalContent}
		</div>
	);
}
