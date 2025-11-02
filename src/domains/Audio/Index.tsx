// domains/Audio/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { AudioEdit } from "./Edit";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { replacePathTag } from "../../utils/FolderUtils";

export function AudioIndex() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);

	const [createCounter, setCreateCounter] = useState(0);

	const handlePlay = (audioId: string) => {
		if (!actionService) return;

		actionService.execute("audio:setTrack", {
			audioId: audioId,
		});
	};

	const handleBulkUpdateItemTags = (
		updates: Array<{ itemId: string; newTags: string[] }>
	) => {
		if (!actionService) return;

		actionService.execute("audio:bulkEditTags", {
			updates: updates.map((update) => ({
				audioId: update.itemId,
				tags: update.newTags,
			})),
		});
	};

	const items: IndexViewItem[] = campaign.Audios.map((audio) => ({
		id: audio.Id,
		label: audio.Name,
		icon: "icon-[mdi--music]",
		iconColor: "#002FFB",
		details: `YouTube ID: ${audio.YoutubeId}`,
		tags: audio.Tags || [],
		action: {
			label: "Play",
			icon: "icon-[mdi--play]",
			onClick: () => handlePlay(audio.Id),
		},
	}));

	return (
		<IndexView
			items={items}
			title="Audio Library"
			description="Manage campaign music and sound effects"
			createLabel="Add Audio Track"
			onCreateClick={() => setCreateCounter((prev) => prev + 1)}
			searchEnabled={true}
			searchPlaceholder="Search audio tracks by name..."
			emptyMessage="No audio tracks yet. Add one to get started!"
			onBulkUpdateItemTags={handleBulkUpdateItemTags}
			renderEditForm={(item, { currentPath, closeDrawer }) => {
				const audio = item
					? campaign.Audios.find((a) => a.Id === item.id)
					: undefined;

				const initialTags =
					currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;

				return (
					<AudioEdit
						key={item?.id || `create-${createCounter}`}
						audio={audio}
						initialTags={initialTags}
						onClose={() => closeDrawer?.()}
					/>
				);
			}}
		/>
	);
}