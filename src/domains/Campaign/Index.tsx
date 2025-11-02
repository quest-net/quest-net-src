// Campaign/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { triggerContextUpdate } from "../Context/ContextProvider";
import { CampaignActions } from "./CampaignActions";
import { useNavigate } from "react-router-dom";
import CircularText from "../../components/CircularText/CircularText";
import PixelBlast from "../../components/PixelBlast/PixelBlast";
import { useThemeColors } from "../../utils/ThemeUtils";

export function CampaignIndex() {
	const context = useQuestContext();
	const navigate = useNavigate();
	const [campaignName, setCampaignName] = useState("");
	const [customRoomCode, setCustomRoomCode] = useState("");
	const [joinRoomCode, setJoinRoomCode] = useState("");
	const colors = useThemeColors("neutral", "primary");
	const handleCreateCampaign = () => {
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

		// Domain action mutates context
		const campaign = CampaignActions.create({ 
			name: campaignName, 
			roomCode: roomCode || undefined 
		}, context);

		// Manually trigger update
		triggerContextUpdate();

		setCampaignName("");
		setCustomRoomCode("");

		// Navigate to the new campaign as DM (using campaign ID)
		navigate(`/${campaign.Id}`);
	};

	const handleJoinCampaign = () => {
		if (!joinRoomCode.trim()) {
			alert("Please enter a room code");
			return;
		}

		// Navigate to the campaign as player (using room code)
		navigate(`/${joinRoomCode.toLowerCase()}`);
	};

	const handleDeleteCampaign = (campaignId: string, campaignName: string) => {
		if (!window.confirm(`Delete campaign "${campaignName}"?`)) {
			return;
		}

		// Domain action mutates context
		CampaignActions.delete({ campaignId }, context);

		// Manually trigger update
		triggerContextUpdate();
	};

	return (
		<div className="relative h-screen w-screen overflow-hidden bg-base-200">
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
					{/* Left Column - Create Campaign */}
					<div className="space-y-6">
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
					<div className="card bg-base-100 shadow-xl border-2 border-base-300">
						<div className="card-body">
							<h2 className="card-title text-2xl mb-4">
								Your Campaigns ({context.Campaigns.length})
							</h2>

							<div className="overflow-auto max-h-[calc(100vh-16rem)] space-y-4">
								{context.Campaigns.length === 0 ? (
									<div className="text-center py-12 opacity-60">
										<div className="text-4xl mb-4">🎲</div>
										<p>No campaigns yet. Create one to get started!</p>
									</div>
								) : (
									context.Campaigns.map((campaign) => (
										<div
											key={campaign.Id}
											className="card bg-base-200 border-2 border-base-300 hover:border-primary cursor-pointer transition-all hover:shadow-lg"
											onClick={() => navigate(`/${campaign.Id}`)}
										>
											<div className="card-body p-4">
												<h3 className="text-xl font-bold">{campaign.Name}</h3>
												
												<div className="flex flex-wrap gap-2 text-sm">
													<div className="badge badge-outline gap-1">
														<span className="icon-[mdi--key] w-3 h-3" />
														{campaign.RoomCode}
													</div>
													<div className="badge badge-outline gap-1">
														<span className="icon-[mdi--account-group] w-3 h-3" />
														{campaign.CharacterRoster.length} characters
													</div>
												</div>

												<div className="text-xs opacity-60 mt-2">
													Last activity: {campaign.Log.length > 0
														? new Date(
																campaign.Log[campaign.Log.length - 1].Timestamp
														  ).toLocaleString()
														: "Never"}
												</div>

												<div className="card-actions justify-end mt-2">
													<button
														onClick={(e) => {
															e.stopPropagation();
															handleDeleteCampaign(campaign.Id, campaign.Name);
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
		</div>
	);
}