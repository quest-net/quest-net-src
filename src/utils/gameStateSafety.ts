import type { GameState, SerializableGameState } from '../types/game';

export interface StateDiffMetrics {
  partyDiffPercentage: number;
  itemsDiffPercentage: number;
  skillsDiffPercentage: number;
  entitiesDiffPercentage: number;
  imagesDiffPercentage: number;
  overallDiffPercentage: number;
  details: {
    partyRemoved: number;
    partyAdded: number;
    itemsRemoved: number;
    itemsAdded: number;
    skillsRemoved: number;
    skillsAdded: number;
    entitiesRemoved: number;
    entitiesAdded: number;
    imagesRemoved: number;
    imagesAdded: number;
  };
}

export interface SafetyCheckResult {
  isSafe: boolean;
  metrics: StateDiffMetrics;
  reason?: string;
}

const SAFETY_THRESHOLDS = {
  overall: 50, // 50% overall change is dangerous
  party: 70,   // Party changes are especially sensitive
  items: 60,
  skills: 60,
  entities: 60,
  images: 60
} as const;

/**
 * Calculate the percentage difference between two arrays based on IDs
 */
function calculateArrayDifference<T extends { id: string }>(
  oldArray: T[],
  newArray: T[]
): { diffPercentage: number; added: number; removed: number } {
  const oldIds = new Set(oldArray.map(item => item.id));
  const newIds = new Set(newArray.map(item => item.id));

  let added = 0;
  let removed = 0;

  // Count additions
  newIds.forEach(id => {
    if (!oldIds.has(id)) added++;
  });

  // Count removals
  oldIds.forEach(id => {
    if (!newIds.has(id)) removed++;
  });
  
  const totalChanges = added + removed;
  const maxPossibleChanges = oldArray.length + newArray.length;
  const diffPercentage = (totalChanges / maxPossibleChanges) * 100;

  return { diffPercentage, added, removed };
}

/**
 * Calculate comprehensive difference metrics between two game states
 */
export function calculateStateDifference(
  oldState: GameState,
  newState: SerializableGameState
): StateDiffMetrics {
  // Calculate differences for each major collection
  const partyDiff = calculateArrayDifference(oldState.party, newState.party);
  const itemsDiff = calculateArrayDifference(
    oldState.globalCollections.items,
    newState.globalCollections.items
  );
  const skillsDiff = calculateArrayDifference(
    oldState.globalCollections.skills,
    newState.globalCollections.skills
  );
  const entitiesDiff = calculateArrayDifference(
    [...oldState.globalCollections.entities, ...oldState.field],
    [...newState.globalCollections.entities, ...newState.field]
  );
  const imagesDiff = calculateArrayDifference(
    oldState.globalCollections.images,
    newState.globalCollections.images
  );

  // Calculate overall difference percentage
  const totalOldItems = oldState.party.length +
    oldState.globalCollections.items.length +
    oldState.globalCollections.skills.length +
    oldState.globalCollections.entities.length +
    oldState.field.length +
    oldState.globalCollections.images.length;

  const totalNewItems = newState.party.length +
    newState.globalCollections.items.length +
    newState.globalCollections.skills.length +
    newState.globalCollections.entities.length +
    newState.field.length +
    newState.globalCollections.images.length;

  const totalChanges = partyDiff.added + partyDiff.removed +
    itemsDiff.added + itemsDiff.removed +
    skillsDiff.added + skillsDiff.removed +
    entitiesDiff.added + entitiesDiff.removed +
    imagesDiff.added + imagesDiff.removed;

  const overallDiffPercentage = (totalChanges / (totalOldItems + totalNewItems)) * 100;

  return {
    partyDiffPercentage: partyDiff.diffPercentage,
    itemsDiffPercentage: itemsDiff.diffPercentage,
    skillsDiffPercentage: skillsDiff.diffPercentage,
    entitiesDiffPercentage: entitiesDiff.diffPercentage,
    imagesDiffPercentage: imagesDiff.diffPercentage,
    overallDiffPercentage,
    details: {
      partyRemoved: partyDiff.removed,
      partyAdded: partyDiff.added,
      itemsRemoved: itemsDiff.removed,
      itemsAdded: itemsDiff.added,
      skillsRemoved: skillsDiff.removed,
      skillsAdded: skillsDiff.added,
      entitiesRemoved: entitiesDiff.removed,
      entitiesAdded: entitiesDiff.added,
      imagesRemoved: imagesDiff.removed,
      imagesAdded: imagesDiff.added
    }
  };
}

/**
 * Check if a state update is safe to apply
 */
export function isStateUpdateSafe(
  oldState: GameState,
  newState: SerializableGameState
): SafetyCheckResult {
  // Don't perform safety checks if there's no existing state
  if (!oldState.party.length && !oldState.globalCollections.items.length) {
    return { isSafe: true, metrics: calculateStateDifference(oldState, newState) };
  }

  const metrics = calculateStateDifference(oldState, newState);

  // Check each threshold
  if (metrics.overallDiffPercentage > SAFETY_THRESHOLDS.overall) {
    return {
      isSafe: false,
      metrics,
      reason: `Overall changes (${metrics.overallDiffPercentage.toFixed(1)}%) exceed safety threshold of ${SAFETY_THRESHOLDS.overall}%`
    };
  }

  if (metrics.partyDiffPercentage > SAFETY_THRESHOLDS.party) {
    return {
      isSafe: false,
      metrics,
      reason: `Party changes (${metrics.partyDiffPercentage.toFixed(1)}%) exceed safety threshold of ${SAFETY_THRESHOLDS.party}%`
    };
  }

  if (metrics.itemsDiffPercentage > SAFETY_THRESHOLDS.items) {
    return {
      isSafe: false,
      metrics,
      reason: `Item changes (${metrics.itemsDiffPercentage.toFixed(1)}%) exceed safety threshold of ${SAFETY_THRESHOLDS.items}%`
    };
  }

  if (metrics.skillsDiffPercentage > SAFETY_THRESHOLDS.skills) {
    return {
      isSafe: false,
      metrics,
      reason: `Skill changes (${metrics.skillsDiffPercentage.toFixed(1)}%) exceed safety threshold of ${SAFETY_THRESHOLDS.skills}%`
    };
  }

  if (metrics.entitiesDiffPercentage > SAFETY_THRESHOLDS.entities) {
    return {
      isSafe: false,
      metrics,
      reason: `Entity changes (${metrics.entitiesDiffPercentage.toFixed(1)}%) exceed safety threshold of ${SAFETY_THRESHOLDS.entities}%`
    };
  }

  if (metrics.imagesDiffPercentage > SAFETY_THRESHOLDS.images) {
    return {
      isSafe: false,
      metrics,
      reason: `Image changes (${metrics.imagesDiffPercentage.toFixed(1)}%) exceed safety threshold of ${SAFETY_THRESHOLDS.images}%`
    };
  }

  return { isSafe: true, metrics };
}