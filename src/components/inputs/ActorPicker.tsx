import { useMemo } from "react";
import { ObjectPicker, ObjectTypeConfig } from "./ObjectPicker";
import { Actor } from "../../domains/Actor/Actor";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";

interface ActorPickerProps {
    isOpen: boolean;
    onConfirm: (actorId: string, amount?: number) => void;
    onCancel: () => void;
    title?: string;
    excludeActorId?: string; // To prevent transferring to self
    includeSharedInventories?: boolean;
    showAmount?: boolean; // Show amount input (for stat transfers)
    amountMax?: number; // Max transfer amount
    amountLabel?: string; // Label for amount input (default: "Amount")
}

export function ActorPicker({
    isOpen,
    onConfirm,
    onCancel,
    title = "Select Actor",
    excludeActorId,
    includeSharedInventories = false,
    showAmount = false,
    amountMax = 99,
    amountLabel = "Amount",
}: ActorPickerProps) {
    const context = useQuestContext();
    const campaign = CampaignActions.getActiveCampaign(context);

    // Players may only interact with actors on the terrain their selected
    // character currently occupies; the DM can target any actor anywhere.
    const playerTerrainId = useMemo(() => {
        if (context.User.Role !== "player") return null;
        const selectedId = context.User.SelectedCharacters[campaign.RoomCode];
        if (!selectedId) return null;
        const selected = campaign.GameState.Characters.find(
            (c) => c.Id === selectedId
        );
        return selected?.Position.terrainId ?? null;
    }, [context.User, campaign.RoomCode, campaign.GameState.Characters]);

    // Prepare data
    const actorTypes = useMemo(() => {
        const onPlayerTerrain = (actor: Actor) =>
            playerTerrainId === null ||
            actor.Position.terrainId === playerTerrainId;

        const characters = campaign.GameState.Characters.filter(
            (c) => c.Id !== excludeActorId && onPlayerTerrain(c)
        );
        const entities = campaign.GameState.Entities.filter(
            (e) => e.Id !== excludeActorId && onPlayerTerrain(e)
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
                icon: "icon-[mdi--robot]",
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
    }, [campaign.GameState, campaign.Settings.SharedInventories, excludeActorId, includeSharedInventories, playerTerrainId]);

    const handleConfirm = (selectedIds: string[], _objectType: string, count: number) => {
        if (selectedIds.length > 0) {
            onConfirm(selectedIds[0], showAmount ? count : undefined);
        }
    };

    return (
        <ObjectPicker
            isOpen={isOpen}
            types={actorTypes}
            multiSelect={false}
            showCount={showAmount}
            countLabel={amountLabel}
            countMax={amountMax}
            onConfirm={handleConfirm}
            onCancel={onCancel}
            title={title}
        />
    );
}
