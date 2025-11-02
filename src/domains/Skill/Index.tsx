// domains/Skill/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { replacePathTag } from "../../utils/FolderUtils";
import { Skill } from "./Skill";
import { SkillEdit } from "./Edit";

export function SkillIndex() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);

	// Force a fresh key for the create drawer so it resets cleanly each time
	const [createCounter, setCreateCounter] = useState(0);

	const handleBulkUpdateSkillTags = (
		updates: Array<{ itemId: string; newTags: string[] }>
	) => {
		if (!actionService) return;

		actionService.execute("skill:bulkEditTags", {
			updates: updates.map((update) => ({
				skillId: update.itemId,
				tags: update.newTags,
			})),
		});
	};

	const skills: IndexViewItem[] = (campaign.SkillTemplates as Skill[]).map(
		(skill) => ({
			id: skill.Id,
			label: skill.Name,
			details: skill.Description,
			imageId: skill.Image,
			tags: skill.Tags || [],
		})
	);

	return (
		<IndexView
			items={skills}
			title="Skills"
			description="Manage your skill templates"
			createLabel="Create Skill"
			onCreateClick={() => setCreateCounter((prev) => prev + 1)}
			searchEnabled={true}
			searchPlaceholder="Search skills by name..."
			emptyMessage="No skills yet. Create one to get started!"
			onBulkUpdateItemTags={handleBulkUpdateSkillTags}
			renderEditForm={(item, { currentPath, closeDrawer }) => {
				const found = item
					? (campaign.SkillTemplates as Skill[]).find((s) => s.Id === item.id)
					: undefined;

				const initialTags =
					currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;

				return (
					<SkillEdit
						key={item?.id || `create-${createCounter}`}
						skill={found}
						initialTags={initialTags}
						onClose={() => closeDrawer?.()}
					/>
				);
			}}
		/>
	);
}