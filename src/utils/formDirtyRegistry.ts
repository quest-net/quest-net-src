// utils/formDirtyRegistry.ts

/**
 * Module-level registry of forms that currently have unsaved changes.
 *
 * Form dirty state lives per-FormWrapper instance, but some app-wide concerns
 * (e.g. the idle auto-refresh) need to know whether *any* form is dirty without
 * threading context through the tree. Each FormWrapper reports its dirty state
 * here keyed by a stable id; consumers read the aggregate on demand.
 */
const dirtyFormIds = new Set<string>();

export function setFormDirty(id: string, dirty: boolean): void {
	if (dirty) {
		dirtyFormIds.add(id);
	} else {
		dirtyFormIds.delete(id);
	}
}

export function clearFormDirty(id: string): void {
	dirtyFormIds.delete(id);
}

export function isAnyFormDirty(): boolean {
	return dirtyFormIds.size > 0;
}
