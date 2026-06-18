// domains/Audio/Edit.tsx

import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { Audio } from "./Audio";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/editors/TagEditor";

interface AudioEditProps {
	audio?: Audio;
	initialTags?: string[];
	onClose: () => void;
}

export function AudioEdit({ audio, initialTags, onClose }: AudioEditProps) {
	const { actionService } = useActionService();

	const defaultAudio: Omit<Audio, "Id"> = {
		Name: "",
		YoutubeId: "",
		Tags: initialTags || [],
	};

	const initialData = audio || { ...defaultAudio, Id: crypto.randomUUID() };

	const handleSave = (data: Audio) => {
		if (!actionService) return;

		if (!audio) {
			// Create mode
			actionService.execute("audio:create", {
				audio: {
					Name: data.Name,
					YoutubeId: data.YoutubeId,
					Tags: data.Tags,
				},
			});
		} else {
			// Edit mode
			actionService.execute("audio:edit", {
				audioId: data.Id,
				updates: {
					Name: data.Name,
					YoutubeId: data.YoutubeId,
					Tags: data.Tags,
				},
			});
		}
	};

	const handleClone = (data: Audio) => {
		if (!actionService) return;

		actionService.execute("audio:create", {
			audio: {
				Name: `${data.Name} (Copy)`,
				YoutubeId: data.YoutubeId,
				Tags: data.Tags,
			},
		});

		onClose();
	};

	const handleDelete = () => {
		if (!actionService || !audio) return;

		actionService.execute("audio:delete", {
			audioId: audio.Id,
		});
	};

	return (
		<FormWrapper
			domain="audio"
			entityId={audio?.Id}
			initialData={initialData}
			onSave={handleSave}
			onClose={onClose}
			onClone={audio ? handleClone : undefined}
			onDelete={audio ? handleDelete : undefined}
			createTitle="Add Audio Track"
			editTitle="Edit Audio Track"
			viewTitle="View Audio Track"
		>
			<AudioForm />
		</FormWrapper>
	);
}

// ============================================================================
// AUDIO FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface AudioFormProps {
	data?: Audio;
	onChange?: (data: Audio) => void;
}

function AudioForm({ data, onChange }: AudioFormProps) {
	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Audio, value: any) => {
		onChange({
			...data,
			[field]: value,
		});
	};

	return (
		<>
			{/* Basic Info */}
			<FormSection
				title="Track Information"
				description="Audio track name and YouTube source"
			>
				<FormGrid cols={1}>
					<FormField label="Track Name">
						<input
							type="text"
							value={data.Name}
							onChange={(e) => handleFieldChange("Name", e.target.value)}
							className="input input-bordered w-full"
							placeholder="Leave empty to use video name"
						/>
					</FormField>

					<FormField label="YouTube URL or ID">
						<input
							type="text"
							value={data.YoutubeId}
							onChange={(e) => handleFieldChange("YoutubeId", e.target.value)}
							className="input input-bordered w-full"
							placeholder="https://youtube.com/watch?v=... or video ID"
						/>
					</FormField>
				</FormGrid>
			</FormSection>

			{/* Tags */}
			<FormSection
				title="Tags"
				description="Organizational tags for this audio track"
			>
				<TagEditor
					tags={data.Tags || []}
					onChange={(tags) => handleFieldChange("Tags", tags)}
				/>
			</FormSection>
		</>
	);
}
