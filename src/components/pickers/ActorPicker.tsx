import { useMemo } from "react";
import { ObjectPicker, ObjectTypeConfig } from "./ObjectPicker";
import { Actor } from "../../domains/Actor/Actor";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import { beginTargeting } from "../Map/Targeting/targetingStore";
import { isActorVisibleToUser } from "../../domains/Actor/ActorVisibilityUtils";
import { useOutOfSightActorIds } from "../Map/useOutOfSightActorIds";

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
    /**
     * Pick only from these actors (e.g. owner candidates, which can include
     * benched roster characters) instead of the spawned actors on the field.
     */
    candidates?: Actor[];
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
    candidates,
}: ActorPickerProps) {
    const context = useQuestContext();
    const campaign = CampaignUtils.getActiveCampaign(context);

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

    const outOfSight = useOutOfSightActorIds();

    // Prepare data
    const actorTypes = useMemo(() => {
        if (candidates) {
            return [
                {
                    label: "Characters",
                    items: candidates.filter((a) => a.Id !== excludeActorId),
                    icon: "icon-[mdi--account-group]",
                    typeKey: "character",
                },
            ] as ObjectTypeConfig<Actor | { Id: string; Name: string }>[];
        }
        const onPlayerTerrain = (actor: Actor) =>
            (playerTerrainId === null ||
                actor.Position.terrainId === playerTerrainId) &&
            isActorVisibleToUser(actor, context.User, campaign.RoomCode, outOfSight);

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
    }, [campaign.GameState, campaign.Settings.SharedInventories, campaign.RoomCode, context.User, excludeActorId, includeSharedInventories, playerTerrainId, outOfSight, candidates]);

    const handleConfirm = (selectedIds: string[], _objectType: string, count: number) => {
        if (selectedIds.length > 0) {
            onConfirm(selectedIds[0], showAmount ? count : undefined);
        }
    };

    // "Pick on the map": hand off to map targeting mode (actor-only) and resolve
    // the chosen actor through the same onConfirm. The owning modal/drawer closes
    // so the map is clickable (ObjectPicker cancels itself; DetailDrawer auto-
    // closes while a targeting request is active).
    const handlePickOnMap = (count: number) => {
        beginTargeting({
            allowActor: true,
            allowPosition: false,
            label: title,
            excludeActorId,
            onResolve: (result) => {
                if (
                    result.kind === "actor" &&
                    (!candidates || candidates.some((a) => a.Id === result.actorId))
                ) {
                    onConfirm(result.actorId, showAmount ? count : undefined);
                }
            },
        });
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
            extraAction={{
                label: "or pick on the map",
                icon: "icon-[mdi--map-marker-radius]",
                onClick: handlePickOnMap,
            }}
        />
    );
}
