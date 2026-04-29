// domains/Terrain/Edit.tsx

import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { Terrain } from "./Terrain";
import { TerrainActions } from "./TerrainActions";
import { FormWrapper, useFormReadOnly } from "../../components/Form/Form";
import Map from "../../components/Map/Map";
import { TagEditor } from "../../components/inputs/TagEditor";
import TerrainEditor from "../../components/inputs/TerrainEditor";
import { MapStateProvider } from "../../components/Map/MapStateProvider";

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface TerrainEditProps {
	terrain?: Terrain;
	isDefault?: boolean;
	initialTags?: string[];
	onClose: () => void;
}

export function TerrainEdit({ terrain, isDefault, initialTags, onClose }: TerrainEditProps) {
	const { actionService } = useActionService();

	const initialData = terrain ?? TerrainActions.createNew();

	initialData.Tags = initialTags;

	const handleSave = (data: Terrain) => {
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

	const handleClone = (data: Terrain) => {
		if (!actionService) return;
		const cloned: Terrain = {
			...data,
			Id: crypto.randomUUID(),
			Name: `${data.Name} (Copy)`,
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
			onDelete={terrain && !isDefault ? handleDelete : undefined}
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
	data?: Terrain;
	onChange?: (data: Terrain) => void;
}

function TerrainForm({ data, onChange }: TerrainFormProps) {
	const readOnly = useFormReadOnly();

	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Terrain, value: any) => {
		onChange({ ...data, [field]: value });
	};

	const handleSizeChange = (newWidth: number, newLength: number) => {
		// Validate and clamp to valid range
		const width = Math.max(1, Math.min(48, Math.floor(newWidth) || 1));
		const length = Math.max(1, Math.min(48, Math.floor(newLength) || 1));

		// No change needed
		if (width === data.Width && length === data.Length) return;

		// Create new maps with default values
		const newHeightMap: number[][] = Array.from({ length }, () =>
			Array.from({ length: width }, () => 0)
		);
		const newColorMap: number[][] = Array.from({ length }, () =>
			Array.from({ length: width }, () => 0) // Default to green (index 0)
		);

		// Copy existing data where possible (non-destructive resize)
		const copyLength = Math.min(data.Length, length);
		const copyWidth = Math.min(data.Width, width);

		for (let y = 0; y < copyLength; y++) {
			for (let x = 0; x < copyWidth; x++) {
				newHeightMap[y][x] = data.HeightMap[y][x];
				newColorMap[y][x] = data.ColorMap[y][x];
			}
		}

		onChange({
			...data,
			Width: width,
			Length: length,
			HeightMap: newHeightMap,
			ColorMap: newColorMap,
		});
	};

	const handleTerrainEdited = (next: {
		width: number;
		length: number;
		heightMap: number[][];
		colorMap: number[][];
	}) => {
		onChange({
			...data,
			Width: next.width,
			Length: next.length,
			HeightMap: next.heightMap,
			ColorMap: next.colorMap,
		});
	};

	return (
		<div className="flex flex-col gap-4 min-h-[calc(100dvh-14rem)]">
			{/* Compact header bar: Name | Width | Length */}
			<div className="card border-2 bg-base-100 shrink-0">
				<div className="card-body p-4">
					<div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
						<div className="md:col-span-8 flex flex-col">
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
									(1-48)
								</span>
							</label>
							<input
								type="number"
								value={data.Width}
								onChange={(e) =>
									handleSizeChange(Number(e.target.value), data.Length)
								}
								className="input input-bordered w-full"
								min={1}
								max={48}
								disabled={readOnly}
								readOnly={readOnly}
							/>
						</div>
						<div className="md:col-span-2 flex flex-col">
							<label className="text-sm font-medium mb-1">
								Length
								<span className="text-xs text-base-content/60 ml-1">
									(1-48)
								</span>
							</label>
							<input
								type="number"
								value={data.Length}
								onChange={(e) =>
									handleSizeChange(data.Width, Number(e.target.value))
								}
								className="input input-bordered w-full"
								min={1}
								max={48}
								disabled={readOnly}
								readOnly={readOnly}
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Editor keeps its intrinsic size; preview takes the remaining space. */}
			<div className="grid grid-cols-1 grid-rows-[max-content_minmax(14rem,1fr)] xl:grid-cols-[minmax(34rem,42rem)_minmax(16rem,1fr)] xl:grid-rows-1 gap-4 flex-1 min-h-0">
				{/* Editor */}
				<div className="card border-2 bg-base-100 flex flex-col min-h-fit overflow-visible">
					<div className="card-body p-4 space-y-3 flex flex-col overflow-visible">
						<div>
							<h3 className="text-lg font-semibold">Terrain Editor</h3>
							<p className="text-sm text-base-content/70">
								Paint colors and adjust terrain heights
							</p>
						</div>
						<TerrainEditor
							width={data.Width}
							length={data.Length}
							heightMap={data.HeightMap}
							colorMap={data.ColorMap}
							onChange={handleTerrainEdited}
						/>
					</div>
				</div>

				{/* Preview */}
				<div className="card border-2 bg-base-100 overflow-hidden flex flex-col min-h-[14rem]">
					<div className="card-body p-4 flex flex-col gap-3 min-h-0">
						<div className="shrink-0">
							<h3 className="text-lg font-semibold">Live Map Preview</h3>
						</div>
						<div className="flex-1 min-h-[10rem] w-full rounded-lg border bg-base-200 overflow-hidden">
							<MapStateProvider>
								<Map
									preview
									allowPanZoom
									showControls
									characters={[]}
									entities={[]}
									terrain={data}
								/>
							</MapStateProvider>
						</div>
					</div>
				</div>
			</div>

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
