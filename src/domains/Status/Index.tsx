// domains/Status/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { replacePathTag } from "../../utils/FolderUtils";
import { Status } from "./Status";
import { StatusEdit } from "./Edit";
import { formatTemplateExpiration } from "./StatusUtils";

export function StatusIndex() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);

	// Force a fresh key for the create drawer so it resets cleanly each time
	const [createCounter, setCreateCounter] = useState(0);

	const handleBulkUpdateStatusTags = (
		updates: Array<{ itemId: string; newTags: string[] }>
	) => {
		if (!actionService) return;

		actionService.execute("status:bulkEditTags", {
			updates: updates.map((update) => ({
				statusId: update.itemId,
				tags: update.newTags,
			})),
		});
	};

	const statuses: IndexViewItem[] = (campaign.StatusTemplates as Status[]).map(
		(status) => ({
			id: status.Id,
			label: status.Name,
			details: formatTemplateExpiration(status.Expiration),
			imageId: status.Image,
			tags: status.Tags || [],
		})
	);

	return (
		<IndexView
			items={statuses}
			title="Statuses"
			sortKey="statuses-sort"
			description="Manage your status effect templates"
			createLabel="Create Status"
			onCreateClick={() => setCreateCounter((prev) => prev + 1)}
			searchEnabled={true}
			searchPlaceholder="Search statuses by name..."
			emptyMessage="No statuses yet. Create one to get started!"
			onBulkUpdateItemTags={handleBulkUpdateStatusTags}
			renderEditForm={(item, { currentPath, closeDrawer }) => {
				const found = item
					? (campaign.StatusTemplates as Status[]).find((s) => s.Id === item.id)
					: undefined;

				const initialTags =
					currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;

				return (
					<StatusEdit
						key={item?.id || `create-${createCounter}`}
						status={found}
						initialTags={initialTags}
						onClose={() => closeDrawer?.()}
					/>
				);
			}}
		/>
	);
}