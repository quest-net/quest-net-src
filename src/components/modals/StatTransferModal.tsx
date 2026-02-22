// components/modals/StatTransferModal.tsx

import { useState } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { StatDefinition } from "../../domains/CampaignSetting/CampaignSetting";
import { ActorPicker } from "../inputs/ActorPicker";

interface StatTransferModalProps {
    isOpen: boolean;
    onClose: () => void;
    sourceActorId: string;
    sourceStat: StatDefinition;
    onTransfer: (targetId: string, amount: number) => void;
}

export function StatTransferModal({
    isOpen,
    onClose,
    sourceActorId,
    sourceStat,
    onTransfer,
}: StatTransferModalProps) {
    const context = useQuestContext();
    const campaign = CampaignActions.getActiveCampaign(context);

    const [targetId, setTargetId] = useState<string | null>(null);
    const [amount, setAmount] = useState<number>(1);
    const [isPickerOpen, setIsPickerOpen] = useState(false);

    if (!isOpen) return null;

    const maxTransfer = sourceStat.Current ?? sourceStat.Max;

    // Resolve Target Name
    let targetName = "Select Target";
    if (targetId) {
        const targetActor = [
            ...campaign.GameState.Characters,
            ...campaign.GameState.Entities,
        ].find((a) => a.Id === targetId);
        const targetInv = campaign.Settings.SharedInventories?.find(
            (i) => i.Id === targetId
        );

        targetName = targetActor?.Name || targetInv?.Name || "Unknown";
    }

    const handleTransfer = () => {
        if (targetId && amount > 0 && amount <= maxTransfer) {
            onTransfer(targetId, amount);
            onClose();
        }
    };

    return (
        <dialog className="modal modal-open">
            <div className="modal-box relative">
                <button
                    onClick={onClose}
                    className="btn btn-sm btn-circle absolute right-2 top-2"
                >
                    ✕
                </button>
                <h3 className="font-bold text-lg mb-4">Transfer {sourceStat.Name}</h3>

                <div className="space-y-4">
                    <div className="form-control">
                        <label className="label">
                            <span className="label-text">Target</span>
                        </label>
                        <button
                            className="btn btn-outline"
                            onClick={() => setIsPickerOpen(true)}
                        >
                            {targetName}
                        </button>
                    </div>

                    <div className="form-control">
                        <label className="label">
                            <span className="label-text">Amount to Transfer</span>
                            <span className="label-text-alt opacity-60">
                                Max: {maxTransfer}
                            </span>
                        </label>
                        <input
                            type="number"
                            className="input input-bordered"
                            value={amount}
                            min={1}
                            max={maxTransfer}
                            onChange={(e) => {
                                const val = Math.max(1, Math.min(maxTransfer, Number(e.target.value)));
                                setAmount(val);
                            }}
                        />
                    </div>
                </div>

                <div className="modal-action">
                    <button className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        disabled={!targetId || amount <= 0 || amount > maxTransfer}
                        onClick={handleTransfer}
                    >
                        Transfer
                    </button>
                </div>
            </div>
            <form method="dialog" className="modal-backdrop">
                <button onClick={onClose}>close</button>
            </form>

            <ActorPicker
                isOpen={isPickerOpen}
                onConfirm={(id) => {
                    setTargetId(id);
                    setIsPickerOpen(false);
                }}
                onCancel={() => setIsPickerOpen(false)}
                title="Select Transfer Target"
                excludeActorId={sourceActorId}
                includeSharedInventories={true}
            />
        </dialog>
    );
}
