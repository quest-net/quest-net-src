// domains/Terrain/Edit.tsx

import { useCallback, useEffect, useRef, useState } from "react";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { FormWrapper, useFormReadOnly } from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";
import VoxelTerrainEditor, { type ActorOverlayInfo } from "../../components/inputs/VoxelTerrainEditor";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import type { VoxelTerrain } from "../VoxelTerrain/VoxelTerrain";
import { VoxelTerrainActions } from "../VoxelTerrain/VoxelTerrainActions";
import {
	MAX_VOXEL_TERRAIN_HEIGHT,
	MAX_VOXEL_TERRAIN_WIDTH,
	MAX_VOXEL_TERRAIN_LENGTH,
	clampVoxelTerrainHeight,
	clampVoxelTerrainResolution,
	reshapeVoxelTerrainForEditor,
} from "../../utils/VoxelTerrainEditorUtils";

const TERRAIN_RESOLUTION_OPTIONS = [
	{ value: 1, label: "Basic" },
	{ value: 2, label: "Detailed" },
	{ value: 3, label: "Very Detailed" },
] as const;

const TERRAIN_SHAPE_DEBOUNCE_MS = 300;

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface TerrainEditProps {
	terrain?: VoxelTerrain;
	isDeleteProtected?: boolean;
	initialTags?: string[];
	onClose: () => void;
}

export function TerrainEdit({
	terrain,
	isDeleteProtected,
	initialTags,
	onClose,
}: TerrainEditProps) {
	const { actionService } = useActionService();

	const initialData: VoxelTerrain = terrain
		? {
			...terrain,
			Voxels: terrain.Voxels,
			Tags: initialTags ?? terrain.Tags,
		}
		: {
			...VoxelTerrainActions.createNew(),
			Tags: initialTags,
		};

	const handleSave = (data: VoxelTerrain) => {
		if (!actionService) return;

		if (!terrain) {
			actionService.execute("terrain:create", { terrain: data });
		} else {
			actionService.execute("terrain:edit", {
				terrainId: data.Id,
				updates: data,
			});
		}
	};

	const handleClone = (data: VoxelTerrain) => {
		if (!actionService) return;
		const cloned: VoxelTerrain = {
			...data,
			Id: crypto.randomUUID(),
			Name: `${data.Name} (Copy)`,
			Voxels: data.Voxels,
			Tags: data.Tags ? [...data.Tags] : undefined,
		};
		actionService.execute("terrain:create", { terrain: cloned });
		onClose();
	};

	const handleDelete = () => {
		if (!actionService || !terrain) return;

		actionService.execute("terrain:delete", {
			terrainId: terrain.Id,
		});
	};

	return (
		<FormWrapper
			domain="terrain"
			entityId={terrain?.Id}
			initialData={initialData}
			onSave={handleSave}
			onClose={onClose}
			onClone={terrain ? handleClone : undefined}
			onDelete={terrain && !isDeleteProtected ? handleDelete : undefined}
			createTitle="Create Terrain"
			editTitle="Edit Terrain"
			viewTitle="View Terrain"
			fullWidth
		>
			<TerrainForm />
		</FormWrapper>
	);
}

// ============================================================================
// FORM COMPONENT
// ============================================================================

interface TerrainFormProps {
	data?: VoxelTerrain;
	onChange?: (data: VoxelTerrain) => void;
}

function TerrainForm({ data, onChange }: TerrainFormProps) {
	const readOnly = useFormReadOnly();

	if (!data || !onChange) return null;

	return (
		<TerrainFormFields
			data={data}
			onChange={onChange}
			readOnly={readOnly}
		/>
	);
}

interface TerrainFormFieldsProps {
	data: VoxelTerrain;
	onChange: (data: VoxelTerrain) => void;
	readOnly: boolean;
}

function TerrainFormFields({ data, onChange, readOnly }: TerrainFormFieldsProps) {
	const questContext = useQuestContext();
	const campaign = questContext.ActiveCampaign;

	// Show actor positions only when editing the terrain that is currently
	// active in the game session, so the DM can see where actors stand.
	const isActiveTerrain = !!(
		data.Id && campaign?.GameState?.VoxelTerrainId === data.Id
	);
	const actorOverlayInfos: ActorOverlayInfo[] =
		isActiveTerrain && campaign
			? [
				...(campaign.GameState.Characters ?? []),
				...(campaign.GameState.Entities ?? []),
			].map(actor => ({
				id: actor.Id,
				name: actor.Name,
				position: actor.Position,
			}))
			: [];

	const terrainRef = useRef(data);
	const [shapeDraft, setShapeDraft] = useState(() => ({
		width: data.Width,
		length: data.Length,
		height: clampVoxelTerrainHeight(data.Height),
		resolution: clampVoxelTerrainResolution(data.Resolution),
	}));
	const shapeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		terrainRef.current = data;
		setShapeDraft({
			width: data.Width,
			length: data.Length,
			height: clampVoxelTerrainHeight(data.Height),
			resolution: clampVoxelTerrainResolution(data.Resolution),
		});
	}, [data]);

	const handleFieldChange = (field: keyof VoxelTerrain, value: any) => {
		onChange({ ...data, [field]: value });
	};

	const commitShapeChange = useCallback(
		(nextDraft: typeof shapeDraft) => {
			onChange(
				reshapeVoxelTerrainForEditor(terrainRef.current, {
					width: nextDraft.width,
					length: nextDraft.length,
					height: nextDraft.height,
					resolution: nextDraft.resolution,
				})
			);
		},
		[onChange]
	);

	const scheduleShapeChange = useCallback(
		(nextDraft: typeof shapeDraft) => {
			setShapeDraft(nextDraft);
			if (shapeDebounceRef.current) {
				clearTimeout(shapeDebounceRef.current);
			}
			shapeDebounceRef.current = setTimeout(() => {
				shapeDebounceRef.current = null;
				commitShapeChange(nextDraft);
			}, TERRAIN_SHAPE_DEBOUNCE_MS);
		},
		[commitShapeChange]
	);

	const flushShapeChange = useCallback(() => {
		if (shapeDebounceRef.current) {
			clearTimeout(shapeDebounceRef.current);
			shapeDebounceRef.current = null;
			commitShapeChange(shapeDraft);
		}
	}, [commitShapeChange, shapeDraft]);

	useEffect(
		() => () => {
			if (shapeDebounceRef.current) {
				clearTimeout(shapeDebounceRef.current);
			}
		},
		[]
	);

	const updateShapeDraft = (updates: Partial<typeof shapeDraft>) => {
		if (readOnly) return;
		const nextDraft = {
			...shapeDraft,
			...updates,
		};
		nextDraft.width = Math.max(1, Math.min(MAX_VOXEL_TERRAIN_WIDTH, Math.floor(nextDraft.width) || 1));
		nextDraft.length = Math.max(1, Math.min(MAX_VOXEL_TERRAIN_LENGTH, Math.floor(nextDraft.length) || 1));
		nextDraft.height = clampVoxelTerrainHeight(nextDraft.height);
		nextDraft.resolution = clampVoxelTerrainResolution(nextDraft.resolution);
		scheduleShapeChange(nextDraft);
	};

	return (
		<div className="flex flex-col gap-4 min-h-[calc(100dvh-14rem)]">
			{/* Compact header bar: Name | Width | Length */}
			<div className="card border-2 bg-base-100 shrink-0">
				<div className="card-body p-4">
					<div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
						<div className="md:col-span-4 flex flex-col">
							<label className="text-sm font-medium mb-1">Name</label>
							<input
								type="text"
								value={data.Name}
								onChange={(e) => handleFieldChange("Name", e.target.value)}
								className="input input-bordered w-full"
								placeholder="Terrain Name"
								disabled={readOnly}
								readOnly={readOnly}
							/>
						</div>
						<div className="md:col-span-2 flex flex-col">
							<label className="text-sm font-medium mb-1">
								Width
								<span className="text-xs text-base-content/60 ml-1">
									(1-{MAX_VOXEL_TERRAIN_WIDTH})
								</span>
							</label>
							<input
								type="number"
								value={shapeDraft.width}
								onChange={(e) =>
									updateShapeDraft({ width: Number(e.target.value) })
								}
								onBlur={flushShapeChange}
								className="input input-bordered w-full"
								min={1}
								max={MAX_VOXEL_TERRAIN_WIDTH}
								disabled={readOnly}
								readOnly={readOnly}
							/>
						</div>
						<div className="md:col-span-2 flex flex-col">
							<label className="text-sm font-medium mb-1">
								Length
								<span className="text-xs text-base-content/60 ml-1">
									(1-{MAX_VOXEL_TERRAIN_LENGTH})
								</span>
							</label>
							<input
								type="number"
								value={shapeDraft.length}
								onChange={(e) =>
									updateShapeDraft({ length: Number(e.target.value) })
								}
								onBlur={flushShapeChange}
								className="input input-bordered w-full"
								min={1}
								max={MAX_VOXEL_TERRAIN_LENGTH}
								disabled={readOnly}
								readOnly={readOnly}
							/>
						</div>
						<div className="md:col-span-2 flex flex-col">
							<label className="text-sm font-medium mb-1">
								Max Height
								<span className="text-xs text-base-content/60 ml-1">
									(1-{MAX_VOXEL_TERRAIN_HEIGHT})
								</span>
							</label>
							<input
								type="number"
								value={shapeDraft.height}
								onChange={(e) =>
									updateShapeDraft({ height: Number(e.target.value) })
								}
								onBlur={flushShapeChange}
								className="input input-bordered w-full"
								min={1}
								max={MAX_VOXEL_TERRAIN_HEIGHT}
								disabled={readOnly}
								readOnly={readOnly}
							/>
						</div>
						<div className="md:col-span-2 flex flex-col">
							<label className="text-sm font-medium mb-1">Resolution</label>
							<select
								value={shapeDraft.resolution}
								onChange={(e) =>
									updateShapeDraft({ resolution: Number(e.target.value) })
								}
								onBlur={flushShapeChange}
								className="select select-bordered w-full"
								disabled={readOnly}
							>
								{TERRAIN_RESOLUTION_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</div>
					</div>
				</div>
			</div>

			<VoxelTerrainEditor
				terrain={data}
				onChange={onChange}
				readOnly={readOnly}
				actors={actorOverlayInfos}
			/>

			{/* Tags at the bottom */}
			<div className="card border-2 bg-base-100 shrink-0">
				<div className="card-body p-4">
					<div className="flex flex-col">
						<label className="text-sm font-medium mb-1">Tags</label>
						<TagEditor
							tags={data.Tags || []}
							onChange={(tags) => handleFieldChange("Tags", tags)}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

export default TerrainEdit;
