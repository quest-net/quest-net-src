// src/utils/gameStateSafety.ts

interface SafetyMetrics {
  overallDiffPercentage: number;
  categoriesConsidered: string[];
  categoryDetails: {
    [category: string]: {
      oldCount: number;
      newCount: number;
      diffPercentage: number;
      included: boolean;
    };
  };
}

interface SafetyResult {
  isSafe: boolean;
  metrics: SafetyMetrics;
  reason?: string;
}

// Safety thresholds
const PERCENTAGE_THRESHOLD = 60; // 60% change threshold
const MIN_ITEMS_FOR_CONSIDERATION = 10; // Only consider categories with 10+ items

function calculateOverallSafetyMetrics(oldState: any, newState: any): SafetyMetrics {
  const categories = {
    party: {
      old: oldState.party || [],
      new: newState.party || []
    },
    catalogEntities: {
      old: oldState.globalCollections?.entities || [],
      new: newState.globalCollections?.entities || []
    },
    fieldEntities: {
      old: oldState.field || [],
      new: newState.field || []
    },
    items: {
      old: oldState.globalCollections?.items || [],
      new: newState.globalCollections?.items || []
    },
    skills: {
      old: oldState.globalCollections?.skills || [],
      new: newState.globalCollections?.skills || []
    },
    images: {
      old: oldState.globalCollections?.images || [],
      new: newState.globalCollections?.images || []
    }
  };

  const categoryDetails: SafetyMetrics['categoryDetails'] = {};
  const consideredCategories: string[] = [];
  let totalWeightedDiff = 0;
  let totalWeight = 0;

  // Process each category
  for (const [categoryName, arrays] of Object.entries(categories)) {
    const oldCount = arrays.old.length;
    const newCount = arrays.new.length;
    
    // Calculate percentage difference
    const diffPercentage = oldCount === 0 ? 
      (newCount > 0 ? 100 : 0) : 
      Math.abs((newCount - oldCount) / oldCount) * 100;

    const included = oldCount >= MIN_ITEMS_FOR_CONSIDERATION;

    categoryDetails[categoryName] = {
      oldCount,
      newCount,
      diffPercentage,
      included
    };

    // Only include categories with enough items in the overall calculation
    if (included) {
      consideredCategories.push(categoryName);
      totalWeightedDiff += diffPercentage * oldCount;
      totalWeight += oldCount;
    }
  }

  // Calculate overall percentage (weighted by collection size)
  const overallDiffPercentage = totalWeight === 0 ? 0 : totalWeightedDiff / totalWeight;

  return {
    overallDiffPercentage,
    categoriesConsidered: consideredCategories,
    categoryDetails
  };
}

export function isStateUpdateSafe(oldState: any, newState: any): SafetyResult {
  const metrics = calculateOverallSafetyMetrics(oldState, newState);
  
  // If no categories were considered (all collections too small), it's always safe
  if (metrics.categoriesConsidered.length === 0) {
    return {
      isSafe: true,
      metrics
    };
  }

  // Check if overall change exceeds threshold
  if (metrics.overallDiffPercentage > PERCENTAGE_THRESHOLD) {
    return {
      isSafe: false,
      metrics,
      reason: `Overall changes (${metrics.overallDiffPercentage.toFixed(1)}%) exceed safety threshold of ${PERCENTAGE_THRESHOLD}%. Considered categories: ${metrics.categoriesConsidered.join(', ')}`
    };
  }

  return {
    isSafe: true,
    metrics
  };
}