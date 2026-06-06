import { Character } from "../Character/Character";
import { Item } from "../Item/Item";
import { Skill } from "../Skill/Skill";
import { Image } from "../Image/Image";
import { LogEntry } from "../Log/LogEntry";
import { Audio } from "../Audio/Audio";
import { Status } from "../Status/Status";
import { GameState } from "../GameState/GameState";
import { Entity } from "../Entity/Entity";
import { CampaignSettings } from "../CampaignSetting/CampaignSetting";
import { VoxelTerrain } from "../VoxelTerrain/VoxelTerrain";
import { Scenario } from "../Scenario/Scenario";
import { Door } from "../Door/Door";

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
	// (or within one). Undirected; deleting a terrain cascades to purge doors
	// that reference it. See docs/multi-terrain-world.md §4.3.
	Doors: Door[];
	//GameState
	GameState: GameState;
	//Campaign Log
	Log: LogEntry[];
	LogHead: number;
	//Campaign-specific settings
	Settings: CampaignSettings;
}

