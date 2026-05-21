// domains/Audio/AddPlaylistModal.tsx

import { useState } from "react";

interface AddPlaylistModalProps {
	isOpen: boolean;
	onClose: () => void;
	onImport: (playlistUrl: string) => Promise<void>;
}

export function AddPlaylistModal({
	isOpen,
	onClose,
	onImport,
}: AddPlaylistModalProps) {
	const [importUrl, setImportUrl] = useState("");
	const [isImporting, setIsImporting] = useState(false);

	const handleImport = async () => {
		if (!importUrl.trim()) return;

		setIsImporting(true);
		const startTime = Date.now();
		
		try {
			await onImport(importUrl);
			
			// Ensure minimum 500ms loading time
			const elapsed = Date.now() - startTime;
			const remainingTime = Math.max(0, 500 - elapsed);
			
			if (remainingTime > 0) {
				await new Promise(resolve => setTimeout(resolve, remainingTime));
			}
			
			// Success - close modal and reset
			setImportUrl("");
			onClose();
		} catch (error) {
			// Still respect minimum time even on error
			const elapsed = Date.now() - startTime;
			const remainingTime = Math.max(0, 500 - elapsed);
			
			if (remainingTime > 0) {
				await new Promise(resolve => setTimeout(resolve, remainingTime));
			}
			
			alert(error instanceof Error ? error.message : "Import failed");
		} finally {
			setIsImporting(false);
		}
	};

	const handleClose = () => {
		if (isImporting) return; // Don't allow closing during import
		setImportUrl("");
		onClose();
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !isImporting && importUrl.trim()) {
			handleImport();
		}
	};

	if (!isOpen) return null;

	return (
		<dialog className="modal modal-open">
			<div className="modal-box max-w-2xl">
				<h3 className="font-bold text-lg mb-4">Import YouTube Playlist</h3>

				{/* Instructions */}
				<div className="alert alert-warning mb-4">
					<span className="icon-[mdi--information-outline] w-5 h-5 shrink-0" />
					<div className="text-sm">
						<p className="font-semibold mb-2">How to import a playlist:</p>
						<ol className="list-decimal list-inside space-y-1 ml-2">
							<li>
								Navigate to the YouTube playlist page (URL should contain{" "}
								<code className="bg-base-300 px-1 rounded">
									playlist?list=...
								</code>
								)
							</li>
							<li>Click the "Share" button on the playlist</li>
							<li>
								Ensure the playlist is set to <strong>Public</strong> (required
								for import)
							</li>
							<li>Copy the share link and paste it below</li>
						</ol>
					</div>
				</div>

				{/* Note about imported tracks */}
				<div className="bg-base-200 rounded-lg p-3 mb-4">
					<p className="text-sm opacity-70">
						<span className="icon-[mdi--lightbulb-outline] w-4 h-4 inline mr-1" />
						Tracks and the playlist folder will use YouTube names when
						available. Anything unavailable falls back to generic names.
					</p>
				</div>

				{/* Input */}
				<div className="form-control">
					<label className="label">
						<span className="label-text">YouTube Playlist URL or ID</span>
					</label>
					<input
						type="text"
						value={importUrl}
						onChange={(e) => setImportUrl(e.target.value)}
						onKeyDown={handleKeyPress}
						placeholder="https://www.youtube.com/playlist?list=PLxxxx or PLxxxx"
						className="input input-bordered w-full"
						disabled={isImporting}
						autoFocus
					/>
				</div>

				{/* Loading indicator */}
				{isImporting && (
					<div className="mt-4 flex items-center gap-3 text-sm">
						<span className="loading loading-spinner loading-md"></span>
						<div>
							<p className="font-semibold">Importing playlist...</p>
							<p className="opacity-60">
								This may take a moment for large playlists
							</p>
						</div>
					</div>
				)}

				{/* Actions */}
				<div className="modal-action">
					<button
						onClick={handleClose}
						className="btn btn-ghost"
						disabled={isImporting}
					>
						Cancel
					</button>
					<button
						onClick={handleImport}
						className="btn btn-primary"
						disabled={isImporting || !importUrl.trim()}
					>
						{isImporting ? (
							<>
								<span className="loading loading-spinner loading-sm"></span>
								Importing...
							</>
						) : (
							<>
								<span className="icon-[mdi--download] w-5 h-5 mr-1" />
								Import
							</>
						)}
					</button>
				</div>
			</div>
		</dialog>
	);
}
