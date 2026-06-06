// domains/Terrain/Edit.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { FormWrapper, useFormContext, useFormReadOnly } from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";
import VoxelTerrainEditor, {
	type ActorOverlayInfo,
	type VoxelTerrainEditorHandle,
} from "../../components/inputs/VoxelTerrainEditor";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import type {
	EditableVoxelTerrain,
	VoxelTerrain,
} from "../VoxelTerrain/VoxelTerrain";
import type { TerrainLinkAnchor } from "../TerrainLink/TerrainLink";
import { VoxelTerrainActions } from "../VoxelTerrain/VoxelTerrainActions";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import { getTerrainVoxels } from "../../utils/terrain/data/terrainPayloadStore";
import {
	MAX_VOXEL_TERRAIN_HEIGHT,
	MAX_VOXEL_TERRAIN_WIDTH,
	MAX_VOXEL_TERRAIN_LENGTH,
	clampVoxelTerrainHeight,
	clampVoxelTerrainResolution,
} from "../../utils/terrain/editor/VoxelTerrainEditorUtils";
import { listStampTerrains } from "../../utils/terrain/editor/VoxelStampUtils";

const TERRAIN_RESOLUTION_OPTIONS = [
	{ value: 1, label: "Basic" },
	{ value: 2, label: "Detailed" },
	{ value: 3, label: "Very Detailed" },
	{ value: 4, label: "Extreme" },
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
	const questContext = useQuestContext();
	const campaign = questContext.ActiveCampaign;
	const [loadedTerrain, setLoadedTerrain] = useState<
		EditableVoxelTerrain | undefined
	>(() =>
		terrain && TerrainStorageService.isHydrated(terrain)
			? { ...terrain, Voxels: getTerrainVoxels(terrain.Id) }
			: undefined
	);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		if (!terrain) {
			setLoadedTerrain(undefined);
			setLoadError(null);
			return;
		}

		let isMounted = true;
		setLoadError(null);

		if (TerrainStorageService.isHydrated(terrain)) {
			setLoadedTerrain({ ...terrain, Voxels: getTerrainVoxels(terrain.Id) });
			return;
		}

		if (!campaign) {
			setLoadError("Campaign not loaded");
			return;
		}

		setLoadedTerrain(undefined);
		TerrainStorageService.loadTerrainForEditing(campaign, terrain)
			.then((hydrated) => {
				if (!isMounted) return;
				if (!hydrated) {
					setLoadError("Terrain voxel data was not found in storage.");
					return;
				}
				setLoadedTerrain(hydrated);
			})
			.catch((error) => {
				console.error("[TerrainEdit] Failed to load terrain:", error);
				if (isMounted) {
					setLoadError("Failed to load terrain voxel data.");
				}
			});

		return () => {
			isMounted = false;
		};
	}, [campaign, terrain]);

	if (terrain && loadError) {
		return (
			<div className="p-6 text-error">
				<p>{loadError}</p>
			</div>
		);
	}

	if (terrain && !loadedTerrain) {
		return (
			<div className="p-6 flex items-center gap-3">
				<span className="loading loading-spinner loading-sm" />
				<span>Loading terrain...</span>
			</div>
		);
	}

	const terrainData = loadedTerrain;

	const initialData: EditableVoxelTerrain = terrainData
		? {
			...terrainData,
			Voxels: terrainData.Voxels,
			Tags: initialTags ?? terrainData.Tags,
		}
		: {
			...VoxelTerrainActions.createNew(),
			Tags: initialTags,
		};

	const handleSave = (data: EditableVoxelTerrain) => {
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

	const handleClone = (data: EditableVoxelTerrain) => {
		if (!actionService) return;
		const sourceId = data.Id;
		const newId = crypto.randomUUID();
		const cloned: EditableVoxelTerrain = {
			...data,
			Id: newId,
			Name: `${data.Name} (Copy)`,
			Voxels: data.Voxels,
			ContentHash: undefined,
			VoxelCount: undefined,
			PreviewColor: undefined,
			Tags: data.Tags ? [...data.Tags] : undefined,
		};
		actionService.execute("terrain:create", { terrain: cloned });

		// Clone only the source terrain's *intra-terrain* links -- those with both
		// ends on the source -- onto the copy, remapping both anchors to the new
		// terrain id (same tile coords). Cross-terrain links are intentionally not
		// cloned: duplicating one would force a second anchor onto the far terrain's
		// already-occupied tile, which the one-anchor-per-tile rule forbids (and
		// multi-destination tiles are out of scope). terrainLink:create mints fresh
		// link ids; these are queued after terrain:create, and the DM mutation chain
		// runs them in order, so the new terrain exists when each link create validates.
		const remapAnchor = (anchor: TerrainLinkAnchor): TerrainLinkAnchor => ({
			...anchor,
			terrainId: newId,
		});
		for (const link of campaign?.TerrainLinks ?? []) {
			if (link.A.terrainId !== sourceId || link.B.terrainId !== sourceId) continue;
			actionService.execute("terrainLink:create", {
				a: remapAnchor(link.A),
				b: remapAnchor(link.B),
			});
		}

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
	data?: EditableVoxelTerrain;
	onChange?: (data: EditableVoxelTerrain) => void;
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
	data: EditableVoxelTerrain;
	onChange: (data: EditableVoxelTerrain) => void;
	readOnly: boolean;
}

function TerrainFormFields({ data, onChange, readOnly }: TerrainFormFieldsProps) {
	const questContext = useQuestContext();
	const { actionService } = useActionService();
	const { registerSaveResolver } = useFormContext();
	const campaign = questContext.ActiveCampaign;
	const editorRef = useRef<VoxelTerrainEditorHandle>(null);

	// Terrain-link plumbing. Links reference terrain ids, so the edited terrain
	// must already exist in the campaign (i.e. saved) before links can attach to it.
	const canPlaceLinks = !!campaign?.VoxelTerrains.some((t) => t.Id === data.Id);
	const terrainNamesById = useMemo(() => {
		const map = new Map<string, string>();
		for (const t of campaign?.VoxelTerrains ?? []) map.set(t.Id, t.Name);
		return map;
	}, [campaign?.VoxelTerrains]);
	const handleCreateLink = useCallback(
		(a: TerrainLinkAnchor, b: TerrainLinkAnchor) => {
			actionService?.execute("terrainLink:create", { a, b });
		},
		[actionService]
	);
	const handleDeleteLink = useCallback(
		(linkId: string) => {
			actionService?.execute("terrainLink:delete", { linkId });
		},
		[actionService]
	);
	const handleEditLink = useCallback(
		(linkId: string, updates: { Locked?: boolean }) => {
			actionService?.execute("terrainLink:edit", { linkId, updates });
		},
		[actionService]
	);

	// Show the actors that stand on the terrain being edited (matched by their
	// per-actor terrainId), so the DM can see where they are while sculpting.
	const actorOverlayInfos: ActorOverlayInfo[] =
		data.Id && campaign
			? [
				...(campaign.GameState.Characters ?? []),
				...(campaign.GameState.Entities ?? []),
			]
				.filter((actor) => actor.Position.terrainId === data.Id)
				.map(actor => ({
					id: actor.Id,
					name: actor.Name,
					position: actor.Position,
				}))
			: [];

	// Stamps: any terrain tagged path:stamps (or a subfolder thereof), minus
	// the terrain currently being edited. Sources may be unhydrated; the
	// editor calls loadStampVoxels when the user picks one.
	const stampSources = useMemo(
		() => listStampTerrains(campaign?.VoxelTerrains ?? [], data.Id),
		[campaign, data.Id]
	);
	const loadStampVoxels = useCallback(
		async (terrainId: string) => {
			if (!campaign) return null;
			const stamp = campaign.VoxelTerrains.find((t) => t.Id === terrainId);
			if (!stamp) return null;
			return TerrainStorageService.loadTerrainForEditing(campaign, stamp);
		},
		[campaign]
	);

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

	useEffect(() => {
		return registerSaveResolver(
			() => editorRef.current?.materializeTerrain() ?? terrainRef.current
		);
	}, [registerSaveResolver]);

	const handleFieldChange = (field: keyof VoxelTerrain, value: any) => {
		onChange({ ...data, [field]: value });
	};

	const commitShapeChange = useCallback(
		(nextDraft: typeof shapeDraft) => {
			const nextTerrain =
				editorRef.current?.reshapeDraft({
					width: nextDraft.width,
					length: nextDraft.length,
					height: nextDraft.height,
					resolution: nextDraft.resolution,
				}) ?? {
					...terrainRef.current,
					Width: nextDraft.width,
					Length: nextDraft.length,
					Height: nextDraft.height,
					Resolution: nextDraft.resolution,
				};
			terrainRef.current = nextTerrain;
			onChange(nextTerrain);
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
				ref={editorRef}
				terrain={data}
				onChange={onChange}
				readOnly={readOnly}
				actors={actorOverlayInfos}
				stampSources={stampSources}
				loadStampVoxels={loadStampVoxels}
				links={campaign?.TerrainLinks}
				terrainNamesById={terrainNamesById}
				loadTerrainVoxels={loadStampVoxels}
				onCreateLink={handleCreateLink}
				onDeleteLink={handleDeleteLink}
				onEditLink={handleEditLink}
				canPlaceLinks={canPlaceLinks}
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
