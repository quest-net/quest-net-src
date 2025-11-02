// domains/Calendar/Calendar.ts

/** Y/M/D are 1-based for convenience when editing & displaying. */
export interface Calendar {
	year: number;       // 1..∞
	month: number;      // 1..monthsPerYear
	day: number;        // 1..daysPerMonth
	dayOfWeekIndex?: number; // 0..daysPerWeek-1 (undefined if no weeks)
	weekOfMonth?: number;    // 1-based (undefined if no weeks)
	weekOfYear?: number;     // 1-based (undefined if no weeks)
}