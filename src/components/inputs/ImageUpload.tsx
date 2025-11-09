// components/inputs/ImageUpload.tsx
import { useState, useRef } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";
import { ImageActions } from "../../domains/Image/ImageActions";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";
import { Image } from "../../domains/Image/Image";

interface ImageUploadProps {
	value?: string; // Current image ID (for single mode compatibility)
	onChange: (imageId: string | undefined) => void;
	readOnly?: boolean;
	multiple?: boolean; // NEW: Enable multi-file upload
}

type UploadState = "idle" | "processing" | "uploading" | "error";

interface FileUploadStatus {
	file: File;
	state: UploadState;
	error?: string;
	progress?: number;
}

export function ImageUpload({
	value,
	onChange,
	readOnly,
	multiple = false,
}: ImageUploadProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [uploadState, setUploadState] = useState<UploadState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [dragOver, setDragOver] = useState(false);
	const [fileStatuses, setFileStatuses] = useState<FileUploadStatus[]>([]);

	const isDM = context.User.Role === "dm";

	const handleFileSelect = async (files: FileList) => {
		const fileArray = Array.from(files);

		// Filter to only image files
		const imageFiles = fileArray.filter((file) =>
			file.type.startsWith("image/")
		);

		if (imageFiles.length === 0) {
			setError("Please select image files");
			setUploadState("error");
			setTimeout(() => {
				setUploadState("idle");
				setError(null);
			}, 3000);
			return;
		}

		// Single file mode - use original logic
		if (!multiple && imageFiles.length === 1) {
			await handleSingleFileUpload(imageFiles[0]);
			return;
		}

		// Multi-file mode
		if (multiple) {
			await handleMultiFileUpload(imageFiles);
			return;
		}

		// Multiple files selected but multiple mode not enabled
		setError("Please select only one file, or enable multi-upload");
		setUploadState("error");
		setTimeout(() => {
			setUploadState("idle");
			setError(null);
		}, 3000);
	};

	const handleSingleFileUpload = async (file: File) => {
		setError(null);
		setUploadState("processing");

		try {
			// Compress the image
			const { blob, width, height, mimeType } =
				await ImageActions.compressImage(file);

			// Verify size after compression
			if (blob.size > 1024 * 1024) {
				throw new Error(
					`Image is too large (${(blob.size / 1024 / 1024).toFixed(
						2
					)} MB). Maximum size is 1 MB.`
				);
			}

			if (isDM) {
				// DM: Store directly
				setUploadState("uploading");

				const image: Image = {
					Id: crypto.randomUUID(),
					Name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
					FileSize: blob.size,
					MimeType: mimeType,
					Width: width,
					Height: height,
					UploadedBy: undefined,
				};

				// Save to IndexedDB
				await IndexedDBUtilities.save(image.Id, blob);

				// Add to campaign via action service
				if (actionService) {
					actionService.execute("image:create", { image });
				}

				// Return the image ID to the form
				onChange(image.Id);
				setUploadState("idle");
			} else {
				// Player: Send to DM
				setUploadState("uploading");

				if (!actionService) {
					throw new Error("Not connected to game session");
				}

				const imageService = (actionService as any).imageService;
				if (!imageService) {
					throw new Error("Image service not available");
				}

				// Upload to DM and wait for response
				const image = await imageService.uploadImage(
					file,
					file.name.replace(/\.[^/.]+$/, ""),
					context.User.Id
				);

				// Return the image ID to the form
				onChange(image.Id);
				setUploadState("idle");
			}
		} catch (err) {
			console.error("[ImageUpload] Upload failed:", err);
			setError(err instanceof Error ? err.message : "Upload failed");
			setUploadState("error");

			// Reset after showing error
			setTimeout(() => {
				setUploadState("idle");
				setError(null);
			}, 5000);
		}
	};

	const handleMultiFileUpload = async (files: File[]) => {
		setError(null);
		setUploadState("processing");

		// Initialize statuses for all files
		const initialStatuses: FileUploadStatus[] = files.map((file) => ({
			file,
			state: "processing" as UploadState,
			progress: 0,
		}));
		setFileStatuses(initialStatuses);

		try {
			const processedImages: Image[] = [];
			const updatedStatuses = [...initialStatuses];

			// Process all files
			for (let i = 0; i < files.length; i++) {
				const file = files[i];

				try {
					// Compress the image
					const { blob, width, height, mimeType } =
						await ImageActions.compressImage(file);

					// Verify size after compression
					if (blob.size > 1024 * 1024) {
						throw new Error(
							`Too large (${(blob.size / 1024 / 1024).toFixed(
								2
							)} MB). Max 1 MB.`
						);
					}

					const image: Image = {
						Id: crypto.randomUUID(),
						Name: file.name.replace(/\.[^/.]+$/, ""), // Remove extension
						FileSize: blob.size,
						MimeType: mimeType,
						Width: width,
						Height: height,
						UploadedBy: undefined,
					};

					if (isDM) {
						// Save to IndexedDB
						await IndexedDBUtilities.save(image.Id, blob);
						processedImages.push(image);

						updatedStatuses[i] = {
							...updatedStatuses[i],
							state: "idle",
							progress: 100,
						};
					} else {
						// For players, we still need to upload one by one to DM
						// This is a limitation of the current architecture
						updatedStatuses[i] = {
							...updatedStatuses[i],
							state: "uploading",
						};

						if (!actionService) {
							throw new Error("Not connected to game session");
						}

						const imageService = (actionService as any).imageService;
						if (!imageService) {
							throw new Error("Image service not available");
						}

						await imageService.uploadImage(
							file,
							file.name.replace(/\.[^/.]+$/, ""),
							context.User.Id
						);

						updatedStatuses[i] = {
							...updatedStatuses[i],
							state: "idle",
							progress: 100,
						};
					}

					setFileStatuses([...updatedStatuses]);
				} catch (err) {
					updatedStatuses[i] = {
						...updatedStatuses[i],
						state: "error",
						error: err instanceof Error ? err.message : "Failed",
					};
					setFileStatuses([...updatedStatuses]);
				}
			}

			// For DM: Bulk create all processed images in one action
			if (isDM && processedImages.length > 0 && actionService) {
				setUploadState("uploading");
				actionService.execute("image:bulkCreate", { images: processedImages });
			}

			setUploadState("idle");

			// Clear statuses after a delay
			setTimeout(() => {
				setFileStatuses([]);
			}, 3000);
		} catch (err) {
			console.error("[ImageUpload] Bulk upload failed:", err);
			setError(err instanceof Error ? err.message : "Upload failed");
			setUploadState("error");

			setTimeout(() => {
				setUploadState("idle");
				setError(null);
				setFileStatuses([]);
			}, 5000);
		}
	};

	const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (files && files.length > 0) {
			handleFileSelect(files);
		}
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setDragOver(false);

		if (readOnly) return;

		const files = e.dataTransfer.files;
		if (files && files.length > 0) {
			handleFileSelect(files);
		}
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		if (!readOnly) {
			setDragOver(true);
		}
	};

	const handleDragLeave = () => {
		setDragOver(false);
	};

	const handleClear = () => {
		onChange(undefined);
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const handleBrowse = () => {
		fileInputRef.current?.click();
	};

	// Show current image if value exists (single file mode only)
	if (value && uploadState === "idle" && !multiple) {
		return (
			<div className="space-y-2">
				<div className="relative w-full h-48 bg-base-200 rounded-lg overflow-hidden">
					<ImageDisplay
						imageId={value}
						className="w-full h-full object-contain"
						alt="Selected image"
					/>
				</div>

				{!readOnly && (
					<div className="flex gap-2">
						<button
							type="button"
							onClick={handleBrowse}
							className="btn btn-sm btn-primary flex-1"
						>
							Change Image
						</button>
						<button
							type="button"
							onClick={handleClear}
							className="btn btn-sm btn-outline btn-error"
						>
							Clear
						</button>
					</div>
				)}

				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					onChange={handleFileInputChange}
					className="hidden"
				/>
			</div>
		);
	}

	// Show upload area
	return (
		<div className="space-y-2">
			<div
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				className={`
					border-2 border-dashed rounded-lg p-8
					flex flex-col items-center justify-center
					transition-colors cursor-pointer min-h-[200px] m-0
					${dragOver ? "border-primary bg-primary/10" : "border-base-300"}
					${readOnly ? "opacity-50 cursor-not-allowed" : "hover:border-primary"}
					${
					uploadState === "processing" || uploadState === "uploading"
						? "cursor-wait"
						: ""
					}
        		`}
				onClick={!readOnly && uploadState === "idle" ? handleBrowse : undefined}
			>
				{uploadState === "idle" && fileStatuses.length === 0 && (
					<>
						<span className="icon-[mdi--cloud-upload] w-12 h-12 mb-2 opacity-50"></span>
						<p className="text-sm font-medium">
							Drop {multiple ? "images" : "an image"} here or click to browse
						</p>
						<p className="text-s">
							Any image type + GIFs under 1 MB supported.
						</p>
					</>
				)}

				{uploadState === "processing" && fileStatuses.length === 0 && (
					<>
						<span className="loading loading-spinner loading-lg mb-2"></span>
						<p className="text-sm font-medium">
							Processing image{multiple ? "s" : ""}...
						</p>
					</>
				)}

				{uploadState === "uploading" && fileStatuses.length === 0 && (
					<>
						<span className="loading loading-spinner loading-lg mb-2"></span>
						<p className="text-sm font-medium">
							{isDM ? "Saving..." : "Uploading to DM..."}
						</p>
					</>
				)}

				{uploadState === "error" && error && fileStatuses.length === 0 && (
					<>
						<span className="icon-[mdi--alert-circle] w-12 h-12 mb-2 text-error"></span>
						<p className="text-sm font-medium text-error mb-1">Upload Failed</p>
						<p className="text-xs text-error/80 text-center">{error}</p>
					</>
				)}

				{/* Multi-file status display */}
				{fileStatuses.length > 0 && (
					<div className="flex flex-wrap justify-between gap-4">
						{fileStatuses.map((status, index) => (
							<div key={index} className="flex items-center gap-2 text-sm">
								{status.state === "processing" && (
									<span className="loading loading-spinner loading-xs"></span>
								)}
								{status.state === "uploading" && (
									<span className="loading loading-spinner loading-xs text-primary"></span>
								)}
								{status.state === "idle" && (
									<span className="icon-[mdi--check-circle] w-4 h-4 text-success"></span>
								)}
								{status.state === "error" && (
									<span className="icon-[mdi--alert-circle] w-4 h-4 text-error"></span>
								)}
								<span className="flex-1 truncate">{status.file.name}</span>
								{status.error && (
									<span className="text-xs text-error">{status.error}</span>
								)}
							</div>
						))}
					</div>
				)}
			</div>

			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				multiple={multiple}
				onChange={handleFileInputChange}
				disabled={readOnly || uploadState !== "idle"}
				className="hidden"
			/>
		</div>
	);
}
