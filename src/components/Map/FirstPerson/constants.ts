import { THREE_D_MAP_RENDERER } from "../threeDMapConstants";

export const FIRST_PERSON_CAMERA = {
	FOV: 72,
	NEAR: 0.04,
	FAR: THREE_D_MAP_RENDERER.CAMERA_FAR,
	HEIGHT_BY_SIZE: {
		"extra-small": 0.7,
		small: 0.95,
		medium: 1.15,
		large: 1.4,
	},
	PITCH_LIMIT: Math.PI / 2 - 0.08,
} as const;

export const FIRST_PERSON_CONTROLS = {
	MOUSE_SENSITIVITY: 0.0022,
	MOVE_UNITS_PER_SECOND: 4.2,
	FLY_UNITS_PER_SECOND: 3.2,
	SYNC_IDLE_DEBOUNCE_MS: 450,
} as const;

export const FIRST_PERSON_COLLISION = {
	BODY_RADIUS: 0.1,
	FOOT_CLEARANCE: 0.08,
	HEAD_CLEARANCE: 0.28,
} as const;

export const FIRST_PERSON_KEY_CODES = [
	"KeyW",
	"KeyA",
	"KeyS",
	"KeyD",
	"Space",
	"ShiftLeft",
	"ShiftRight",
] as const;

export const MOVEMENT_STATE_UPDATE_MS = 120;
