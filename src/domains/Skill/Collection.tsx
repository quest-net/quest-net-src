// domains/Skill/Collection.tsx

import { CollectionView, CollectionViewItem } from "../../components/CollectionView/CollectionView";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Actor, SkillSlot } from "../Actor/Actor";
import { Skill } from "./Skill";
import { SkillSlotDisplay } from "./SkillSlotDisplay";
import { SkillEdit } from "./Edit";
import { FormDrawer } from "../../components/ui/FormDrawer";
import { useAnimatedDrawer } from "../../hooks/useAnimatedDrawer";
import { formatActionCost, formatStatCost } from "../Actor/ActorCostUtils";

interface SkillCollectionProps {
	actor: Actor;
}

export function SkillCollection({ actor }: SkillCollectionProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const isDm = context.User.Role === "dm";

	// Slot detail drawer (read-only) and DM template-edit drawer.
	const slotDrawer = useAnimatedDrawer<SkillSlot>();
	const editDrawer = useAnimatedDrawer<Skill>();

	// Get the actor's skills
	const slots = actor.Skills;

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
				onClick: () => slotDrawer.open(slot),
				...(isDm ? { onEdit: () => editDrawer.open(skill) } : {}),
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
			{slotDrawer.value && (
				<SkillSlotDisplay
					isOpen={slotDrawer.isOpen}
					onClose={slotDrawer.close}
					slot={slotDrawer.value}
					actor={actor}
				/>
			)}

			{/* DM Template Edit Drawer */}
			{editDrawer.value && (
				<FormDrawer isOpen={editDrawer.isOpen} onClose={editDrawer.close}>
					<SkillEdit skill={editDrawer.value} onClose={editDrawer.close} />
				</FormDrawer>
			)}
		</>
	);
}
