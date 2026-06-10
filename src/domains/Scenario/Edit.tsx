// domains/Scenario/Edit.tsx

import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { Scenario, countPlacements } from "./Scenario";
import {
    FormWrapper,
    FormSection,
    FormField,
    FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";
import { EmptyState } from "../../components/ui/EmptyState";

interface ScenarioEditProps {
    scenario?: Scenario;
    initialTags?: string[];
    onClose: () => void;
}

export function ScenarioEdit({ scenario, initialTags, onClose }: ScenarioEditProps) {
    const { actionService } = useActionService();

    // Note: Scenarios are created via capture, not through this form
    // This form is for editing existing scenarios only
    if (!scenario) {
        return (
            <EmptyState className="text-error">
                Scenarios are created via "Capture Current State"
            </EmptyState>
        );
    }

    const initialData = {
        ...scenario,
        Tags: initialTags ?? scenario.Tags ?? [],
    };

    const handleSave = (data: Scenario) => {
        if (!actionService) return;

        actionService.execute("scenario:edit", {
            scenarioId: data.Id,
            updates: {
                Name: data.Name,
                Tags: data.Tags,
            },
        });
    };

    const handleDelete = () => {
        if (!actionService || !scenario) return;

        actionService.execute("scenario:delete", {
            scenarioId: scenario.Id,
        });
    };

    return (
        <FormWrapper
            domain="scenario"
            entityId={scenario?.Id}
            initialData={initialData}
            onSave={handleSave}
            onClose={onClose}
            onDelete={handleDelete}
            createTitle="Create Scenario"
            editTitle="Edit Scenario"
            viewTitle="Scenario Details"
        >
            <ScenarioForm />
        </FormWrapper>
    );
}

// ============================================================================
// SCENARIO FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface ScenarioFormProps {
    data?: Scenario;
    onChange?: (data: Scenario) => void;
}

function ScenarioForm({ data, onChange }: ScenarioFormProps) {
    if (!data || !onChange) return null;

    const counts = countPlacements(data.ActorPlacements ?? []);

    const handleFieldChange = (field: keyof Scenario, value: any) => {
        onChange({
            ...data,
            [field]: value,
        });
    };

    return (
        <>
            {/* Basic Info */}
            <FormSection
                title="Scenario Information"
                description="Basic scenario details"
            >
                <FormGrid cols={1}>
                    <FormField label="Name">
                        <input
                            type="text"
                            value={data.Name}
                            onChange={(e) => handleFieldChange("Name", e.target.value)}
                            className="input input-bordered w-full"
                            placeholder="e.g. Town Center, Dragon's Lair"
                        />
                    </FormField>
                </FormGrid>
            </FormSection>

            {/* Contents Summary (Read-only) */}
            <FormSection
                title="Scenario Contents"
                description="What this scenario will load (read-only)"
            >
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b border-base-300">
                        <span className="opacity-70">Characters:</span>
                        <span className="font-mono">{counts.characters} placement(s)</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-base-300">
                        <span className="opacity-70">Entities:</span>
                        <span className="font-mono">{counts.entities} placement(s)</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-base-300">
                        <span className="opacity-70">Items:</span>
                        <span className="font-mono">{counts.items} placement(s)</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-base-300">
                        <span className="opacity-70">Audio Tracks:</span>
                        <span className="font-mono">{data.AudioPlaylist.length} track(s)</span>
                    </div>
                    <div className="flex justify-between py-2">
                        <span className="opacity-70">Scene Images:</span>
                        <span className="font-mono">
                            {(data.Scene.EnvironmentImageId ? 1 : 0) + (data.Scene.FocusImageId ? 1 : 0)} image(s)
                        </span>
                    </div>
                </div>
            </FormSection>

            {/* Tags */}
            <FormSection
                title="Tags"
                description="Organizational tags for this scenario"
            >
                <TagEditor
                    tags={data.Tags || []}
                    onChange={(tags) => handleFieldChange("Tags", tags)}
                />
            </FormSection>
        </>
    );
}
