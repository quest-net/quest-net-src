// src/components/Dice/DiceRollerContext.tsx

import {
	createContext,
	useCallback,
	useContext,
	useRef,
	type ReactNode,
} from "react";

/**
 * Handler the mounted DiceRoller registers so other components can ask it to
 * open and load a formula. The roller's own autoroll (when enabled) then fires
 * the roll a moment later; otherwise the user presses Roll.
 */
type RollRequestHandler = (formula: string) => void;

interface DiceRollerContextValue {
	/** Open the dice roller and load the given formula (e.g. "1d20+5"). */
	requestRoll: RollRequestHandler;
	/**
	 * Called by the DiceRoller to register itself as the request consumer.
	 * Pass null on unmount to deregister.
	 */
	registerHandler: (handler: RollRequestHandler | null) => void;
}

const noop = () => {};

const DiceRollerContext = createContext<DiceRollerContextValue>({
	requestRoll: noop,
	registerHandler: noop,
});

/**
 * Bridges the floating DiceRoller and components that want to trigger a roll
 * (e.g. clicking a numeric actor attribute). The roller registers a handler;
 * callers invoke requestRoll(). If no roller is mounted, requestRoll is a no-op.
 */
export function DiceRollerProvider({ children }: { children: ReactNode }) {
	const handlerRef = useRef<RollRequestHandler | null>(null);

	const registerHandler = useCallback(
		(handler: RollRequestHandler | null) => {
			handlerRef.current = handler;
		},
		[]
	);

	const requestRoll = useCallback((formula: string) => {
		handlerRef.current?.(formula);
	}, []);

	return (
		<DiceRollerContext.Provider value={{ requestRoll, registerHandler }}>
			{children}
		</DiceRollerContext.Provider>
	);
}

export function useDiceRoller() {
	return useContext(DiceRollerContext);
}
