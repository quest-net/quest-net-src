import { useMemo } from "react";
import { ObjectPicker, ObjectTypeConfig } from "./ObjectPicker";
import { Actor } from "../../domains/Actor/Actor";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";

interface ActorPickerProps {
    isOpen: boolean;
    onConfirm: (actorId: string) => void;
    onCancel: () => void;
    title?: string;
    excludeActorId?: string; // To prevent transferring to self
}

export function ActorPicker({
    isOpen,
    onConfirm,
    onCancel,
    title = "Select Actor",
    excludeActorId,
}: ActorPickerProps) {
    const context = useQuestContext();
    const campaign = CampaignActions.getActiveCampaign(context);

    // Prepare data
    const actorTypes = useMemo(() => {
        const characters = campaign.GameState.Characters.filter(
            (c) => c.Id !== excludeActorId
        );
        const entities = campaign.GameState.Entities.filter(
            (e) => e.Id !== excludeActorId
        );

        const types: ObjectTypeConfig<Actor>[] = [
            {
                label: "Party",
                items: characters,
                icon: "icon-[mdi--account-group]",
                typeKey: "character",
            },
            {
                label: "Entities",
                items: entities,
                icon: "icon-[mdi--ghost]",
                typeKey: "entity",
            },
        ];

        return types;
    }, [campaign.GameState, excludeActorId]);

    const handleConfirm = (selectedIds: string[]) => {
        if (selectedIds.length > 0) {
            onConfirm(selectedIds[0]);
        }
    };

    return (
        <ObjectPicker
            isOpen={isOpen}
            types={actorTypes}
            multiSelect={false}
            showCount={false}
            onConfirm={handleConfirm}
            onCancel={onCancel}
            title={title}
        />
    );
}
