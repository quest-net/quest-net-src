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
    includeSharedInventories?: boolean;
}

export function ActorPicker({
    isOpen,
    onConfirm,
    onCancel,
    title = "Select Actor",
    excludeActorId,
    includeSharedInventories = false,
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

        const types: ObjectTypeConfig<Actor | { Id: string; Name: string }>[] = [
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

        if (includeSharedInventories && campaign.Settings.SharedInventories) {
            types.push({
                label: "Shared Inventories",
                items: campaign.Settings.SharedInventories,
                icon: "icon-[mdi--treasure-chest]",
                typeKey: "shared-inventory",
            });
        }

        return types;
    }, [campaign.GameState, campaign.Settings.SharedInventories, excludeActorId, includeSharedInventories]);

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
