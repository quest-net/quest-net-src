// domains/Terrain/Edit.tsx

import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { Terrain, TerrainType } from "./Terrain";
import { TerrainActions } from "./TerrainActions";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";
import TerrainEditor from "../../components/inputs/TerrainEditor";

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface TerrainEditProps {
	terrain?: Terrain;
	isDefault?: boolean;
	onClose: () => void;
	onDelete?: () => void; // No longer used - kept for backwards compatibility
}

export function TerrainEdit({ terrain, isDefault, onClose }: TerrainEditProps) {
	const { actionService } = useActionService();

	const initialData = terrain ?? TerrainActions.createNew();

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
		const newColorMap: TerrainType[][] = Array.from({ length }, () =>
			Array.from({ length: width }, () => "green" as TerrainType)
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
		colorMap: TerrainType[][];
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
		<>
			{/* Basic Information */}
			<FormSection
				title="Basic Information"
				description="Terrain name and dimensions"
			>
				<FormGrid cols={2}>
					<FormField label="Name" span={2}>
						<input
							type="text"
							value={data.Name}
							onChange={(e) => handleFieldChange("Name", e.target.value)}
							className="input input-bordered w-full"
							placeholder="Terrain Name"
						/>
					</FormField>

					<FormField label="Width" hint="(1-48 tiles)">
						<input
							type="number"
							value={data.Width}
							onChange={(e) =>
								handleSizeChange(Number(e.target.value), data.Length)
							}
							className="input input-bordered w-full"
							min={1}
							max={48}
						/>
					</FormField>

					<FormField label="Length" hint="(1-48 tiles)">
						<input
							type="number"
							value={data.Length}
							onChange={(e) =>
								handleSizeChange(data.Width, Number(e.target.value))
							}
							className="input input-bordered w-full"
							min={1}
							max={48}
						/>
					</FormField>
				</FormGrid>
			</FormSection>

			{/* Terrain Editor */}
			<FormSection
				title="Terrain Editor"
				description="Paint colors and adjust terrain heights"
			>
				<TerrainEditor
					width={data.Width}
					length={data.Length}
					heightMap={data.HeightMap}
					colorMap={data.ColorMap}
					onChange={handleTerrainEdited}
				/>
			</FormSection>

			{/* Tags */}
			<FormSection title="Tags" description="Organize terrains with tags">
				<TagEditor
					tags={data.Tags || []}
					onChange={(tags) => handleFieldChange("Tags", tags)}
				/>
			</FormSection>
		</>
	);
}

export default TerrainEdit;
