import { Character } from "../Character/Character";
import { Item } from "../Item/Item";
import { Skill } from "../Skill/Skill";
import { Image } from "../Image/Image";
import { LogEntry } from "../Log/Log";
import { Audio } from "../Audio/Audio";
import { Status } from "../Status/Status";
import { GameState } from "../GameState/GameState";
import { Entity } from "../Entity/Entity";
import { CampaignSettings } from "../CampaignSetting/CampaignSetting";
import { VoxelTerrain } from "../VoxelTerrain/VoxelTerrain";
import { Scenario } from "../Scenario/Scenario";
import { TerrainLink } from "../TerrainLink/TerrainLink";
import type { Script, ScriptParam, ScriptVars } from "../Script/Script";

export interface Campaign {
	Id: string;
	Name: string;
	RoomCode: string;
	CreatedAt: number;
	//Global Collections
	CharacterRoster: Character[];
	ItemTemplates: Item[];
	SkillTemplates: Skill[];
	StatusTemplates: Status[];
	EntityTemplates: Entity[];
	VoxelTerrains: VoxelTerrain[];
	Audios: Audio[];
	Images: Image[];
	Scenarios: Scenario[];
	// Campaign-level registry of invisible tile-to-tile links between terrains
	// (or within one). Undirected; deleting a terrain cascades to purge links
	// that reference it.
	TerrainLinks: TerrainLink[];
	//GameState
	GameState: GameState;
	//Campaign Log
	Log: LogEntry[];
	LogHead: number;
	//Campaign-specific settings
	Settings: CampaignSettings;
	// Scripting. Campaign-level hooks are world rules: `this` is the campaign and
	// they can react to any action and reach anything. ScriptVars holds world-rule
	// scratch read in scripts as `this.vars`.
	Scripts?: Script[];
	Parameters?: ScriptParam[];
	ScriptVars?: ScriptVars;
}

