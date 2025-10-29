// Campaign/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { triggerContextUpdate } from "../Context/ContextProvider"; // ← Import update function
import { CampaignActions } from "./CampaignActions";
import { useNavigate } from "react-router-dom";

export function CampaignIndex() {
	const context = useQuestContext();
	const navigate = useNavigate();
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [showJoinForm, setShowJoinForm] = useState(false);
	const [campaignName, setCampaignName] = useState("");
	const [roomCode, setRoomCode] = useState("");

	const handleCreateCampaign = () => {
		if (!campaignName.trim()) {
			alert("Please enter a campaign name");
			return;
		}

		// Domain action mutates context
		const campaign = CampaignActions.create({ name: campaignName }, context);

		// Manually trigger update (needed because we're not using ActionService here)
		triggerContextUpdate();

		setShowCreateForm(false);
		setCampaignName("");

		// Navigate to the new campaign as DM (using campaign ID)
		navigate(`/${campaign.Id}`);
	};

	const handleJoinCampaign = () => {
		if (!roomCode.trim()) {
			alert("Please enter a room code");
			return;
		}

		// Navigate to the campaign as player (using room code)
		navigate(`/${roomCode.toLowerCase()}`);
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
		<div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
			<h1>My Campaigns</h1>

			{/* Action Buttons */}
			<div style={{ marginBottom: "30px", display: "flex", gap: "10px" }}>
				<button
					onClick={() => setShowCreateForm(!showCreateForm)}
					style={{ padding: "10px 20px", cursor: "pointer" }}
				>
					{showCreateForm ? "Cancel" : "+ Create Campaign"}
				</button>
				<button
					onClick={() => setShowJoinForm(!showJoinForm)}
					style={{ padding: "10px 20px", cursor: "pointer" }}
				>
					{showJoinForm ? "Cancel" : "🔗 Join Campaign"}
				</button>
			</div>

			{/* Create Campaign Form */}
			{showCreateForm && (
				<div
					style={{
						marginBottom: "20px",
						padding: "15px",
						border: "2px solid #4CAF50",
						borderRadius: "5px",
					}}
				>
					<h3>Create New Campaign</h3>
					<input
						type="text"
						placeholder="Campaign Name"
						value={campaignName}
						onChange={(e) => setCampaignName(e.target.value)}
						style={{ padding: "8px", width: "300px", marginRight: "10px" }}
					/>
					<button
						onClick={handleCreateCampaign}
						style={{
							padding: "8px 20px",
							cursor: "pointer",
							background: "#4CAF50",
							color: "white",
							border: "none",
						}}
					>
						Create
					</button>
				</div>
			)}

			{/* Join Campaign Form */}
			{showJoinForm && (
				<div
					style={{
						marginBottom: "20px",
						padding: "15px",
						border: "2px solid #2196F3",
						borderRadius: "5px",
					}}
				>
					<h3>Join Existing Campaign</h3>
					<input
						type="text"
						placeholder="Room Code (e.g., brave-dragon-42)"
						value={roomCode}
						onChange={(e) => setRoomCode(e.target.value)}
						style={{ padding: "8px", width: "300px", marginRight: "10px" }}
					/>
					<button
						onClick={handleJoinCampaign}
						style={{
							padding: "8px 20px",
							cursor: "pointer",
							background: "#2196F3",
							color: "white",
							border: "none",
						}}
					>
						Join
					</button>
				</div>
			)}

			{/* Campaign List */}
			<div>
				<h2 className="mb-4">Your Campaigns ({context.Campaigns.length})</h2>
				{context.Campaigns.length === 0 ? (
					<p>No campaigns yet. Create one to get started!</p>
				) : (
					<div className="flex-col gap-4">
						{context.Campaigns.map((campaign) => (
							<div
								key={campaign.Id}
								className="card border p-4 card-body cursor-pointer bg-base-100"
								onClick={() => navigate(`/${campaign.Id}`)}
							>
								<h3 className="text-xl font-bold">{campaign.Name}</h3>
								<div>
									<strong>Room Code:</strong> {campaign.RoomCode}
								</div>
								<div>
									<strong>Last Activity:</strong>{" "}
									{campaign.Log.length > 0
										? new Date(
												campaign.Log[campaign.Log.length - 1].Timestamp
										  ).toLocaleString()
										: "Never"}
								</div>
								<div>
									<button
										onClick={(e) => {
											e.stopPropagation();
											handleDeleteCampaign(campaign.Id, campaign.Name);
										}}
										className="btn btn-error btn-sm"
									>
										Delete
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
