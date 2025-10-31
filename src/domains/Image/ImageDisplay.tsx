// domains/Image/ImageDisplay.tsx

import { useState, useEffect } from "react";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { useQuestContext } from "../Context/ContextProvider";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";

interface ImageDisplayProps extends React.ImgHTMLAttributes<HTMLImageElement> {
	imageId: string | undefined;
}

export function ImageDisplay({ imageId, alt, ...props }: ImageDisplayProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const [src, setSrc] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isDM = context.User.Role === "dm";

	useEffect(() => {
		// Reset state when imageId changes
		setSrc(null);
		setError(null);

		if (!imageId) {
			return;
		}

		let objectUrl: string | null = null;
		let isMounted = true;

		const loadImage = async () => {
			setIsLoading(true);

			try {
				// STEP 1: Try IndexedDB first (works offline for everyone)
				const cached = await IndexedDBUtilities.load(imageId);

				if (cached && isMounted) {
					const blob = cached.data as Blob;
					objectUrl = URL.createObjectURL(blob);
					setSrc(objectUrl);
					setIsLoading(false);
					return;
				}

				// STEP 2: If not cached and we're a player, request from DM
				if (!cached && !isDM) {
					if (!actionService) {
						setError("Not connected");
						setIsLoading(false);
						return;
					}

					const imageService = (actionService as any).imageService;
					if (!imageService) {
						setError("Image service not available");
						setIsLoading(false);
						return;
					}

					// Request from DM (this will cache it in IndexedDB)
					const blob = await imageService.getImage(imageId);

					if (!blob) {
						setError("Image not found");
						setIsLoading(false);
						return;
					}

					if (isMounted) {
						objectUrl = URL.createObjectURL(blob);
						setSrc(objectUrl);
						setIsLoading(false);
					}
					return;
				}

				// STEP 3: Image not found (shouldn't happen for DM)
				if (!cached && isDM) {
					setError("Image not found in IndexedDB");
					setIsLoading(false);
				}
			} catch (err) {
				console.error(`[ImageDisplay] Error loading image ${imageId}:`, err);
				if (isMounted) {
					setError("Failed to load image");
					setIsLoading(false);
				}
			}
		};

		loadImage();

		// Cleanup: revoke object URL to prevent memory leaks
		return () => {
			isMounted = false;
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
			}
		};
	}, [imageId, isDM]);

	// No imageId provided
	if (!imageId) {
		return (
			<div
				className={`flex items-center justify-center bg-base-200 ${
					props.className || ""
				}`}
				style={props.style}
			>
				<span className="icon-[mdi--image-off] w-8 h-8 opacity-30"></span>
			</div>
		);
	}

	// Loading state
	if (isLoading) {
		return (
			<div
				className={`flex items-center justify-center bg-base-200 ${
					props.className || ""
				}`}
				style={props.style}
			>
				<span className="loading loading-spinner loading-sm"></span>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div
				className={`flex items-center justify-center bg-base-200 ${
					props.className || ""
				}`}
				style={props.style}
				title={error}
			>
				<span className="icon-[mdi--image-broken] w-8 h-8 opacity-30"></span>
			</div>
		);
	}

	// Success - render actual image
	if (src) {
		return <img src={src} alt={alt || "Image"} {...props} />;
	}

	// Shouldn't reach here, but just in case
	return null;
}
