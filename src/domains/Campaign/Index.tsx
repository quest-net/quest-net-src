// Campaign/Index.tsx

import { useState, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { triggerContextUpdate } from "../Context/ContextProvider";
import { CampaignActions, ExportProgress } from "./CampaignActions";
import { useNavigate } from "react-router-dom";
import CircularText from "../../components/CircularText/CircularText";
import PixelBlast from "../../components/PixelBlast/PixelBlast";
import { useThemeColors } from "../../utils/ThemeUtils";
import { isGUID } from "../../utils/UrlParser";

export function CampaignIndex() {
	const context = useQuestContext();
	const navigate = useNavigate();
	const [campaignName, setCampaignName] = useState("");
	const [customRoomCode, setCustomRoomCode] = useState("");
	const [joinRoomCode, setJoinRoomCode] = useState("");
	const [importProgress, setImportProgress] = useState<ExportProgress | null>(null);
	const [isImporting, setIsImporting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const colors = useThemeColors("neutral", "primary");
	const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
	const [editRoomCode, setEditRoomCode] = useState("");

	const handleCreateCampaign = async () => {
		if (!campaignName.trim()) {
			alert("Please enter a campaign name");
			return;
		}

		// Validate custom room code if provided
		const roomCode = customRoomCode.trim().toLowerCase();
		if (roomCode) {
			if (roomCode.length > 32) {
				alert("Room code must be 32 characters or less");
				return;
			}
			if (!/^[a-z0-9-]+$/.test(roomCode)) {
				alert("Room code can only contain lowercase letters, numbers, and hyphens");
				return;
			}
			// Check for duplicates
			if (context.Campaigns.some(c => c.RoomCode === roomCode)) {
				alert("This room code is already in use");
				return;
			}
		}

		// Domain action persists to IndexedDB and adds CampaignInfo to context
		const info = await CampaignActions.create({
			name: campaignName,
			roomCode: roomCode || undefined,
		}, context);

		// Manually trigger update
		triggerContextUpdate();

		setCampaignName("");
		setCustomRoomCode("");

		// Navigate to the new campaign as DM (using campaign ID)
		navigate(`/${info.Id}`);
	};

	const handleJoinCampaign = () => {
		if (!joinRoomCode.trim()) {
			alert("Please enter a room code");
			return;
		}

		// Navigate to the campaign as player (using room code)
		navigate(`/${joinRoomCode.toLowerCase()}`);
	};

	const handleDeleteCampaign = async (campaignId: string, campaignName: string) => {
		if (!window.confirm(`Delete campaign "${campaignName}"?`)) {
			return;
		}

		// Domain action removes CampaignInfo + IndexedDB payload
		await CampaignActions.delete({ campaignId }, context);

		// Manually trigger update
		triggerContextUpdate();
	};

	const handleEditRoomCodeClick = (campaignId: string, currentRoomCode: string) => {
		setEditingCampaignId(campaignId);
		setEditRoomCode(currentRoomCode);
	};

	const handleSaveRoomCode = async (campaignId: string) => {
		const roomCode = editRoomCode.trim().toLowerCase();

		// Validation
		if (!roomCode) {
			alert("Room code cannot be empty");
			return;
		}

		if (roomCode.length > 32) {
			alert("Room code must be 32 characters or less");
			return;
		}

		if (!/^[a-z0-9-]+$/.test(roomCode)) {
			alert("Room code can only contain lowercase letters, numbers, and hyphens");
			return;
		}

		// Check for duplicates (excluding current campaign)
		const existingRoomCodes = context.Campaigns
			.filter(c => c.Id !== campaignId)
			.map(c => c.RoomCode);

		if (existingRoomCodes.includes(roomCode)) {
			alert("This room code is already in use by another campaign");
			return;
		}

		// Save (awaited because it may need to load from IndexedDB)
		await CampaignActions.edit(
			{ campaignId, updates: { RoomCode: roomCode } },
			context
		);
		triggerContextUpdate();

		// Close modal
		setEditingCampaignId(null);
		setEditRoomCode("");
	};

	const handleCancelEdit = () => {
		setEditingCampaignId(null);
		setEditRoomCode("");
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		setIsImporting(true);
		setImportProgress({
			current: 0,
			total: 1,
			status: "Starting import...",
		});

		try {
			const campaign = await CampaignActions.importFromFile(
				{ file },
				context,
				setImportProgress
			);

			// Manually trigger update
			triggerContextUpdate();

			// Show success for a moment
			setTimeout(() => {
				setImportProgress(null);
				setIsImporting(false);
				
				// Navigate to the imported campaign
				navigate(`/${campaign.Id}`);
			}, 1500);
		} catch (error) {
			console.error("Import failed:", error);
			alert(
				`Import failed: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
			setImportProgress(null);
			setIsImporting(false);
		}

		// Reset file input
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	return (
		<div className="relative h-screen w-screen overflow-hidden bg-base-200">
			{/* Hidden file input for import */}
			<input
				ref={fileInputRef}
				type="file"
				accept=".json"
				onChange={handleImportFile}
				className="hidden"
			/>

			{/* PixelBlast Background */}
			<div className="absolute inset-0 z-0">
				<PixelBlast
					variant="circle"
					pixelSize={8}
					color={colors.neutral.hex}
					patternScale={5}
					patternDensity={1.4}
					pixelSizeJitter={1.5}
					speed={1.5}
					edgeFade={0.125}
					transparent
				/>
			</div>
			{/* Back Button - Top Left */}
			<button
				onClick={() => navigate("/")}
				className="absolute top-6 left-6 z-2 btn btn-neutral gap-2"
			>
				<span className="icon-[mdi--arrow-left] w-5 h-5" />
				Home
			</button>

			{/* Circular Text - Top Right */}
			<div className="absolute -top-[25%] -right-[25%] pointer-events-auto z-0">
				<CircularText
					text="IMAGINE ✦ IMAGINE ✦ IMAGINE ✦ IMAGINE ✦ IMAGINE ✦ "
					spinDuration={60}
					textColor="text-primary"
					fontSize="text-4xl"
					radius="50vh"
					direction="clockwise"
					fontFamily="font-qyore"
				/>
			</div>

			{/* Circular Text - Bottom Left */}
			<div className="absolute -bottom-[25%] -left-[25%] pointer-events-auto z-0">
				<CircularText
					text="FORGET ✦ FORGET ✦ FORGET ✦ FORGET ✦ FORGET ✦ "
					spinDuration={60}
					textColor="text-primary"
					fontSize="text-4xl"
					radius="50vh"
					direction="clockwise"
					fontFamily="font-qyore"
				/>
			</div>

			{/* Main Content */}
			<div className="relative z-1 h-full flex items-center justify-center p-8">
				<div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-8">
					{/* Left Column - Create/Join Campaign */}
					<div className="space-y-6">
						{/* Create Campaign */}
						<div className="card bg-base-100 shadow-xl border-2 border-base-300">
							<div className="card-body">
								<h2 className="card-title text-2xl mb-4">Create New Campaign</h2>
								
								<div className="form-control">
									<label className="label">
										<span className="label-text font-semibold">Campaign Name</span>
									</label>
									<input
										type="text"
										placeholder="Enter campaign name"
										value={campaignName}
										onChange={(e) => setCampaignName(e.target.value)}
										className="input input-bordered w-full"
										maxLength={100}
									/>
								</div>

								<div className="form-control">
									<label className="label">
										<span className="label-text font-semibold">Room Code (Optional)</span>
									</label>
									<input
										type="text"
										placeholder="Leave blank for random code"
										value={customRoomCode}
										onChange={(e) => setCustomRoomCode(e.target.value.toLowerCase())}
										className="input input-bordered w-full font-mono"
										maxLength={32}
									/>
									<label className="label">
										<span className="label-text-alt">Lowercase letters, numbers, and hyphens only (max 32 chars)</span>
									</label>
								</div>

								<button
									onClick={handleCreateCampaign}
									className="btn btn-primary w-full mt-4 gap-2"
								>
									<span className="icon-[mdi--plus-circle] w-5 h-5" />
									Create Campaign
								</button>
							</div>
						</div>

						{/* Join Campaign */}
						<div className="card bg-base-100 shadow-xl border-2 border-base-300">
							<div className="card-body">
								<h2 className="card-title text-2xl mb-4">Join Campaign</h2>
								
								<div className="form-control">
									<label className="label">
										<span className="label-text font-semibold">Room Code</span>
									</label>
									<input
										type="text"
										placeholder="e.g., brave-dragon-42"
										value={joinRoomCode}
										onChange={(e) => setJoinRoomCode(e.target.value.toLowerCase())}
										className="input input-bordered w-full font-mono"
										maxLength={32}
									/>
								</div>

								<button
									onClick={handleJoinCampaign}
									className="btn btn-secondary w-full mt-4 gap-2"
								>
									<span className="icon-[mdi--link] w-5 h-5" />
									Join Campaign
								</button>
							</div>
						</div>
					</div>

					{/* Right Column - Campaign List */}
					<div
						className="card overflow-hidden bg-base-100 shadow-xl border-2 border-base-300"
						style={{ height: "min(36.2rem, calc(100vh - 8rem))" }}
					>
						<div className="card-body min-h-0 max-h-full overflow-hidden flex flex-col">
							<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 mb-4">
								<h2 className="card-title text-2xl">
									Your Campaigns ({context.Campaigns.length})
								</h2>
								
								<button
									onClick={handleImportClick}
									disabled={isImporting}
									className="btn btn-sm btn-neutral gap-2"
									title="Import campaign from JSON file"
								>
									{isImporting ? (
										<>
											<span className="loading loading-spinner loading-xs" />
											Importing...
										</>
									) : (
										<>
											<span className="icon-[mdi--upload] w-4 h-4" />
											Import
										</>
									)}
								</button>
							</div>

							{importProgress && (
								<div className="shrink-0 space-y-2 mb-4 p-4 bg-base-200 rounded-lg border border-base-300">
									<div className="flex justify-between text-sm">
										<span>{importProgress.status}</span>
										<span className="font-mono">
											{importProgress.current} / {importProgress.total}
										</span>
									</div>
									<progress
										className="progress progress-success w-full"
										value={importProgress.current}
										max={importProgress.total}
									/>
								</div>
							)}

							<div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
								{context.Campaigns.length === 0 ? (
									<div className="text-center py-12 opacity-60">
										<div className="text-4xl mb-4">🎲</div>
										<p>No campaigns yet. Create one to get started!</p>
									</div>
								) : (
									// Most-recent activity first so the campaign you were
									// just playing surfaces at the top.
									[...context.Campaigns]
										.sort((a, b) => b.LastActivity - a.LastActivity)
										.map((info) => (
										<div
											key={info.Id}
											className="card bg-base-200 border-2 border-base-300 hover:border-primary cursor-pointer transition-all hover:shadow-lg"
											onClick={() => navigate(`/${info.Id}`)}
										>
											<div className="card-body p-4">
												<h3 className="text-xl font-bold">{info.Name}</h3>

												<div className="flex flex-wrap gap-2 text-sm">
													<div className="badge badge-outline gap-1">
														<span className="icon-[mdi--key] w-3 h-3" />
														{info.RoomCode}
													</div>
													<div className="badge badge-outline gap-1">
														<span className="icon-[mdi--account-group] w-3 h-3" />
														{info.CharacterCount} characters
													</div>
												</div>

												<div className="text-xs opacity-60 mt-2">
													Last activity: {info.LastActivity > info.CreatedAt
														? new Date(info.LastActivity).toLocaleString()
														: "Never"}
												</div>

												<div className="card-actions justify-end mt-2">
													{isGUID(info.Id) && (
														<div className="tooltip tooltip-bottom" data-tip="Start in secret mode to prepare without broadcasting updates">
															<button
																onClick={(e) => {
																	e.stopPropagation();
																	if (!context.SecretModes) context.SecretModes = {};
																	context.SecretModes[info.Id] = true;
																	navigate(`/${info.Id}`);
																}}
																className="btn btn-neutral btn-sm gap-1"
															>
																<span className="icon-[mdi--eye-off] w-4 h-4" />
																Secret Start
															</button>
														</div>
													)}
													<button
														onClick={(e) => {
															e.stopPropagation();
															handleEditRoomCodeClick(info.Id, info.RoomCode);
														}}
														className="btn btn-neutral btn-sm gap-1"
													>
														<span className="icon-[mdi--pencil] w-4 h-4" />
														Edit Code
													</button>
													<button
														onClick={(e) => {
															e.stopPropagation();
															handleDeleteCampaign(info.Id, info.Name);
														}}
														className="btn btn-error btn-sm gap-1"
													>
														<span className="icon-[mdi--delete] w-4 h-4" />
														Delete
													</button>
												</div>
											</div>
										</div>
									))
								)}
							</div>
						</div>
					</div>
				</div>
			</div>

	{editingCampaignId && (
				<div className="modal modal-open">
					<div className="modal-box">
						<h3 className="font-bold text-lg mb-4">Edit Room Code</h3>
						
						<div className="form-control">
							<label className="label">
								<span className="label-text font-semibold">Room Code</span>
							</label>
							<input
								type="text"
								value={editRoomCode}
								onChange={(e) => setEditRoomCode(e.target.value.toLowerCase())}
								className="input input-bordered w-full font-mono"
								placeholder="brave-dragon-42"
								maxLength={32}
								autoFocus
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										handleSaveRoomCode(editingCampaignId);
									} else if (e.key === 'Escape') {
										handleCancelEdit();
									}
								}}
							/>
							<label className="label">
								<span className="label-text-alt">
									Lowercase letters, numbers, and hyphens only (max 32 chars)
								</span>
							</label>
						</div>

						<div className="modal-action">
							<button onClick={handleCancelEdit} className="btn btn-neutral">
								Cancel
							</button>
							<button 
								onClick={() => handleSaveRoomCode(editingCampaignId)} 
								className="btn btn-primary"
							>
								Save Room Code
							</button>
						</div>
					</div>
					<div className="modal-backdrop" onClick={handleCancelEdit}></div>
				</div>
			)}
		</div>
	);
}
