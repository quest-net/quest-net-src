// components/inputs/ImagePicker.tsx

import { useState } from "react";
import { createPortal } from "react-dom"; // Add this import
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";
import { ImageUpload } from "./ImageUpload";

interface ImagePickerProps {
	value?: string;
	onChange: (imageId: string | undefined) => void;
	readOnly?: boolean;
}

export function ImagePicker({
	value,
	onChange,
	readOnly,
}: ImagePickerProps) {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

	const [isOpen, setIsOpen] = useState(false);
	const [selectedImageId, setSelectedImageId] = useState<string | undefined>(value);
	const [searchQuery, setSearchQuery] = useState("");
	const [showUpload, setShowUpload] = useState(false);
	const [isHovered, setIsHovered] = useState(false);

	const filteredImages = campaign.Images.filter((image) => {
		const matchesSearch = image.Name.toLowerCase().includes(searchQuery.toLowerCase());
		
		// Permission filter - players only see their own uploads, DMs see everything
		const hasPermission = context.User.Role === "dm" || image.UploadedBy === context.User.Id;
		
		return matchesSearch && hasPermission;
	});

	const handleOpen = () => {
		if (readOnly) return;
		setSelectedImageId(value);
		setSearchQuery("");
		setShowUpload(false);
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

	// Create the modal content
	const modalContent = isOpen ? (
		<div className="modal modal-open">
			<div className="modal-box max-w-5xl max-h-[90vh] flex flex-col">
				{/* Header */}
				<div className="flex justify-between items-center mb-4">
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
						className="btn btn-primary btn-sm mb-4"
					>
						<span className="icon-[mdi--upload] w-4 h-4 mr-2" />
						Upload New Image
					</button>
				) : (
					<div className="mb-4 p-4 border-2 border-primary rounded-lg">
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

				{/* Search */}
				<div className="flex gap-2 mb-4">
					<input
						type="text"
						placeholder="Search images..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="input input-bordered input-sm flex-1"
					/>
					{searchQuery && (
						<button
							onClick={() => setSearchQuery("")}
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
							{filteredImages.map((image) => (
								<div
									key={image.Id}
									onClick={() => setSelectedImageId(image.Id)}
									className={`
										card bg-base-100 border-2 cursor-pointer transition-all
										${
											selectedImageId === image.Id
												? "border-primary ring-2 ring-primary"
												: "border-base-300 hover:border-primary"
										}
									`}
								>
									<figure className="px-2 pt-2">
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

				{/* Footer Actions */}
				<div className="flex justify-between items-center">
					<button
						onClick={handleClear}
						className="btn btn-neutral btn-sm"
						disabled={!selectedImageId}
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
					${!readOnly ? 'cursor-pointer' : ''}
					transition-opacity
					${!readOnly && isHovered ? 'opacity-70' : 'opacity-100'}
				`}
			>
				{value ? (
					// Show image if set
					<ImageDisplay
						imageId={value}
						className="w-full h-full object-contain"
						alt="Selected image"
					/>
				) : (
					// Show "no image" icon or edit button
					<>
						<span 
							className={`icon-[mdi--image-off] w-24 h-24 opacity-30 transition-opacity ${
								isHovered && !readOnly ? 'opacity-0' : 'opacity-30'
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