// domains/Terrain/TerrainActions.ts

import { Context } from "../Context/Context";
import { Terrain, TerrainType } from "./Terrain";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";

export const TerrainActions = {
  
  /**
   * Creates the default terrain that every campaign starts with
   * This terrain cannot be deleted and is always available
   */
  createDefault(): Terrain {
    const width = 20;
    const length = 20;
    
    // Initialize empty height map (all 0s)
    const heightMap: number[][] = Array(length)
      .fill(null)
      .map(() => Array(width).fill(0));
    
    // Initialize color map (all green)
    const colorMap: TerrainType[][] = Array(length)
      .fill(null)
      .map(() => Array(width).fill('green' as TerrainType));
    
    return {
      Id: 'DEFAULT_TERRAIN',
      Name: 'Default Terrain',
      Width: width,
      Length: length,
      HeightMap: heightMap,
      ColorMap: colorMap
    };
  },

  /**
   * Creates a new blank terrain (for user-created terrains)
   */
  createNew(): Terrain {
    const width = 20;
    const length = 20;
    
    // Initialize empty height map (all 0s)
    const heightMap: number[][] = Array(length)
      .fill(null)
      .map(() => Array(width).fill(0));
    
    // Initialize color map (all green)
    const colorMap: TerrainType[][] = Array(length)
      .fill(null)
      .map(() => Array(width).fill('green' as TerrainType));
    
    return {
      Id: crypto.randomUUID(),
      Name: 'New Terrain',
      Width: width,
      Length: length,
      HeightMap: heightMap,
      ColorMap: colorMap
    };
  },

  /**
   * Creates a new terrain and adds it to the campaign
   */
  create(params: { terrain: Terrain }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    campaign.Terrains.push(params.terrain);
    
    LogActions.create({
      action: 'Terrain created',
      details: `${params.terrain.Name} (${params.terrain.Width}×${params.terrain.Length})`,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  },

  /**
   * Edits a terrain's properties
   */
  edit(params: { terrainId: string; updates: Partial<Terrain> }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    const terrain = campaign.Terrains.find(t => t.Id === params.terrainId);
    if (!terrain) {
      console.warn(`Terrain not found: ${params.terrainId}`);
      return;
    }
    
    Object.assign(terrain, params.updates);
    
    LogActions.create({
      action: 'Terrain updated',
      details: terrain.Name,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  },

  /**
   * Deletes a terrain from the campaign
   * Cannot delete the default terrain (DEFAULT_TERRAIN)
   */
  delete(params: { terrainId: string }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    // Prevent deletion of default terrain
    if (params.terrainId === 'DEFAULT_TERRAIN') {
      console.warn('Cannot delete the default terrain');
      return;
    }
    
    const index = campaign.Terrains.findIndex(t => t.Id === params.terrainId);
    if (index === -1) {
      console.warn(`Terrain not found: ${params.terrainId}`);
      return;
    }
    
    const terrain = campaign.Terrains[index];
    
    // Check if this terrain is currently active
    if (campaign.GameState.TerrainId === params.terrainId) {
      console.warn('Cannot delete active terrain. Switch to another terrain first.');
      return;
    }
    
    campaign.Terrains.splice(index, 1);
    
    LogActions.create({
      action: 'Terrain deleted',
      details: terrain.Name,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  },

  /**
   * Sets a terrain as the active terrain for the game
   * If terrainId is undefined, falls back to DEFAULT_TERRAIN
   */
  setActive(params: { terrainId: string | undefined }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    if (params.terrainId) {
      // Verify terrain exists
      const terrain = campaign.Terrains.find(t => t.Id === params.terrainId);
      if (!terrain) {
        console.warn(`Terrain not found: ${params.terrainId}`);
        return;
      }
      
      campaign.GameState.TerrainId = params.terrainId;
      
      LogActions.create({
        action: 'Terrain activated',
        details: terrain.Name,
        category: 'system',
        level: 'important',
        visibility: ['all']
      }, context);
    } else {
      // Fall back to default terrain instead of clearing
      campaign.GameState.TerrainId = 'DEFAULT_TERRAIN';
      
      LogActions.create({
        action: 'Terrain reset to default',
        category: 'system',
        level: 'info',
        visibility: ['all']
      }, context);
    }
  },

  /**
   * Updates a single tile in the terrain
   */
  updateTile(params: {
    terrainId: string;
    x: number;
    y: number;
    height?: number;
    color?: TerrainType;
  }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    const terrain = campaign.Terrains.find(t => t.Id === params.terrainId);
    if (!terrain) {
      console.warn(`Terrain not found: ${params.terrainId}`);
      return;
    }
    
    // Validate coordinates
    if (params.y < 0 || params.y >= terrain.Length || 
        params.x < 0 || params.x >= terrain.Width) {
      console.warn(`Invalid coordinates: (${params.x}, ${params.y})`);
      return;
    }
    
    // Update height if provided
    if (params.height !== undefined) {
      // Clamp to 0-16 range
      terrain.HeightMap[params.y][params.x] = Math.max(0, Math.min(16, params.height));
    }
    
    // Update color if provided
    if (params.color !== undefined) {
      terrain.ColorMap[params.y][params.x] = params.color;
    }
  },

  /**
   * Resizes a terrain (preserves existing data where possible)
   */
  resize(params: {
    terrainId: string;
    newWidth: number;
    newLength: number;
  }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    
    const terrain = campaign.Terrains.find(t => t.Id === params.terrainId);
    if (!terrain) {
      console.warn(`Terrain not found: ${params.terrainId}`);
      return;
    }
    
    const { newWidth, newLength } = params;
    
    // Create new maps with default values
    const newHeightMap: number[][] = Array(newLength)
      .fill(null)
      .map(() => Array(newWidth).fill(0));
    
    const newColorMap: TerrainType[][] = Array(newLength)
      .fill(null)
      .map(() => Array(newWidth).fill('green' as TerrainType));
    
    // Copy existing data
    const copyLength = Math.min(terrain.Length, newLength);
    const copyWidth = Math.min(terrain.Width, newWidth);
    
    for (let y = 0; y < copyLength; y++) {
      for (let x = 0; x < copyWidth; x++) {
        newHeightMap[y][x] = terrain.HeightMap[y][x];
        newColorMap[y][x] = terrain.ColorMap[y][x];
      }
    }
    
    // Update terrain
    terrain.Width = newWidth;
    terrain.Length = newLength;
    terrain.HeightMap = newHeightMap;
    terrain.ColorMap = newColorMap;
    
    LogActions.create({
      action: 'Terrain resized',
      details: `${terrain.Name} resized to ${newWidth}×${newLength}`,
      category: 'system',
      level: 'info',
      visibility: ['dm']
    }, context);
  }
};