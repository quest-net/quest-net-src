// domains/Skill/Collection.tsx

import { useState } from "react";
import { CollectionView, CollectionViewItem } from "../../components/CollectionView/CollectionView";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Actor, SkillSlot } from "../Actor/Actor";
import { SkillSlotDisplay } from "./SkillSlotDisplay";
import { formatActionCost, formatStatCost } from "../../utils/ActorCostUtils";

interface SkillCollectionProps {
	actor: Actor;
}

export function SkillCollection({ actor }: SkillCollectionProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);

	// Drawer state
	const [isDrawerOpen, setDrawerOpen] = useState(false);
	const [selectedSlot, setSelectedSlot] = useState<SkillSlot | null>(null);

	// Get the actor's skills
	const slots = actor.Skills;

	// Handle skill click - open drawer
	const handleSkillClick = (slot: SkillSlot) => {
		setSelectedSlot(slot);
		setDrawerOpen(true);
	};

	// Handle drawer close
	const handleCloseDrawer = () => {
		setDrawerOpen(false);
		// Small delay before clearing selected slot to avoid visual flash
		setTimeout(() => setSelectedSlot(null), 300);
	};

	// Map slots to CollectionViewItem format
	const items: CollectionViewItem[] = slots
    .map((slot, index) => {
        const skill = campaign.SkillTemplates.find((t) => t.Id === slot.Id);
        if (!skill) return null;

			// Format uses text
			const usesText =
				slot.UsesLeft !== undefined
					? `${slot.UsesLeft}/${skill.MaxUses || "∞"}`
					: "∞";

			const statCostText = skill.StatCost
				? `Costs ${formatStatCost(skill.StatCost, campaign.Settings, "")}`
				: "";
			const actionCostText = skill.ActionCost
				? `Costs ${formatActionCost(skill.ActionCost, campaign.Settings, "")}`
				: "";

			// Combine details
			const details = [
				`${usesText} uses`,
				statCostText,
				actionCostText,
			].filter(Boolean).join(" • ");

			return {
				id: `${slot.Id}-${index}`, 
				label: skill.Name,
				details: details,
				description: skill.Description,
				imageId: skill.Image,
				badge: skill.DiceRoll,
				onClick: () => handleSkillClick(slot),
			};
		})
		.filter(Boolean) as CollectionViewItem[];

	return (
		<>
			<CollectionView
				items={items}
				title="Skills"
				emptyMessage="No skills learned"
				viewModeKey="skills-view"
				searchEnabled={true}
				searchPlaceholder="Search skills..."
			/>

			{/* Skill Slot Display Drawer */}
			{selectedSlot && (
				<SkillSlotDisplay
					isOpen={isDrawerOpen}
					onClose={handleCloseDrawer}
					slot={selectedSlot}
					actor={actor}
				/>
			)}
		</>
	);
}
