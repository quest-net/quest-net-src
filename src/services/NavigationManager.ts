// src/services/NavigationManager.ts

import { highlightManager } from './HighlightManager';

type DMLinkLocation = 'catalog' | 'inventory' | 'equipment' | 'field' | 'visuals' | 'encounters' | 'audio' | 'characters' | 'skills';
type PlayerLinkLocation = 'inventory' | 'equipment' | 'skills';
type DMTabType = 'characters' | 'visuals' | 'audio' | 'catalog' | 'encounter' | 'battle' | 'settings';
type PlayerTabType = 'equipment' | 'inventory' | 'skills' | 'settings';
type AllTabTypes = DMTabType | PlayerTabType;

type CatalogRecipientType = 'character' | 'globalEntity' | 'fieldEntity';
type CatalogContentType = 'items' | 'skills';

interface ModalControls {
  showInventoryModal: (characterId: string) => void;
  showEquipmentModal: (characterId: string) => void;
  showSkillsModal: (characterId: string) => void;
}

interface CatalogControls {
  setRecipientType: (type: CatalogRecipientType) => void;
  setContentType: (type: CatalogContentType) => void;
}

type NavigationLocation = {
  type: DMLinkLocation | PlayerLinkLocation;
  containerId?: string;
  containerName?: string;
};

type SearchResultType = 'item' | 'skill' | 'character' | 'entity' | 'image' | 'audio';

interface NavigationResult {
  id: string;
  type: SearchResultType;
  location: NavigationLocation;
}

export class NavigationManager {
  static scrollAndHighlight(elementId: string, type?: SearchResultType) {
    // Dispatch search navigation event for images
    if (type === 'image') {
      const searchEvent = new CustomEvent('searchNavigation', {
        detail: {
          id: elementId.replace('environment-image-', '').replace('focus-image-', ''),
          type: 'image'
        }
      });
      window.dispatchEvent(searchEvent);
    }
  
    // Longer delay to ensure content is rendered
    setTimeout(() => {
      const { scrollManager } = require('./ScrollManager');
      const { highlightManager } = require('./HighlightManager');
      
      // First scroll
      scrollManager.scrollToElement(elementId);
      
      // Then highlight after a small additional delay
      setTimeout(() => {
        highlightManager.highlight(elementId);
      }, 50);
    }, 150);
  }
  static handleDMNavigation(
    result: NavigationResult,
    currentTab: DMTabType,
    setTab: (tab: DMTabType) => void,
    isCombatActive: boolean = false,
    modalControls?: ModalControls,
    catalogControls?: CatalogControls
  ) {
    
    // Handle character-related content (inventory/equipment/skills)
    const isCharacterContent = result.location.containerId && 
      (result.location.type === 'inventory' || 
       result.location.type === 'equipment' || 
       result.location.type === 'skills');

       if (isCharacterContent && modalControls && result.location.containerId) {
        // Navigate to characters tab and open appropriate modal
        setTab('characters');
      

      
        // Then show the appropriate modal
        setTimeout(() => {
          switch (result.location.type) {
            case 'inventory':
              modalControls.showInventoryModal(result.location.containerId!);
              // Add second highlight for the item inside modal
              NavigationManager.scrollAndHighlight(result.id);
              break;
            case 'equipment':
              modalControls.showEquipmentModal(result.location.containerId!);
              NavigationManager.scrollAndHighlight(result.id);
              break;
            case 'skills':
              modalControls.showSkillsModal(result.location.containerId!);
              NavigationManager.scrollAndHighlight(result.id);
              break;
          }
        }, 100);

      return;
    }

    // Handle navigation based on result type
    switch (result.type) {
      case 'character':
        if (currentTab === 'catalog' && catalogControls) {
          catalogControls.setRecipientType('character');
          NavigationManager.scrollAndHighlight(`recipient-${result.id}`);
        } else {
          setTab('characters');
          NavigationManager.scrollAndHighlight(`character-${result.id}`);
        }
        break;

        case 'entity':
          if (currentTab === 'catalog' && catalogControls) {
            catalogControls.setRecipientType(
              result.location.type === 'field' ? 'fieldEntity' : 'globalEntity'
            );
            NavigationManager.scrollAndHighlight(`recipient-${result.id}`);
          } else {
            if (result.location.type === 'field') {
              setTab(isCombatActive ? 'battle' : 'encounter');
            } else {
              setTab('encounter');
            }
            NavigationManager.scrollAndHighlight(result.id);
          }
          break;
          
      case 'item':
      case 'skill':
        if (result.location.type === 'catalog') {
          setTab('catalog');
          if (catalogControls) {
            catalogControls.setContentType(result.type === 'item' ? 'items' : 'skills');
          }
          // Small delay to ensure tab switch completes
          setTimeout(() => {
            NavigationManager.scrollAndHighlight(result.id);
          }, 100);
        }
        break;

        case 'image':
          setTab('visuals');
          setTimeout(() => {
            NavigationManager.scrollAndHighlight(`environment-image-${result.id}`, 'image');
            NavigationManager.scrollAndHighlight(`focus-image-${result.id}`, 'image');
          }, 100);
          break;

      case 'audio':
        setTab('audio');
        NavigationManager.scrollAndHighlight(result.id);
        break;
    }
  }

  static handlePlayerNavigation(
    result: NavigationResult, 
    isInSafeView: boolean,
    callbacks: {
      setShowInventory?: (show: boolean) => void;
      setShowEquipment?: (show: boolean) => void;
      setShowSkills?: (show: boolean) => void;
      setActiveTab?: (tab: PlayerTabType) => void;
    }
  ) {
    const {
      setShowInventory,
      setShowEquipment,
      setShowSkills,
      setActiveTab
    } = callbacks;

    if (isInSafeView && setActiveTab) {
      switch (result.location.type as PlayerLinkLocation) {
        case 'inventory':
          setActiveTab('inventory');
          NavigationManager.scrollAndHighlight(result.id);
          break;
        case 'equipment':
          setActiveTab('equipment');
          NavigationManager.scrollAndHighlight(result.id);
          break;
        case 'skills':
          setActiveTab('skills');
          NavigationManager.scrollAndHighlight(result.id);
          break;
      }
    } else {
      switch (result.location.type as PlayerLinkLocation) {
        case 'inventory':
          setShowInventory?.(true);
          NavigationManager.scrollAndHighlight(result.id);
          break;
        case 'equipment':
          setShowEquipment?.(true);
          NavigationManager.scrollAndHighlight(result.id);
          break;
        case 'skills':
          setShowSkills?.(true);
          NavigationManager.scrollAndHighlight(result.id);
          break;
      }
    }

    // Clear any existing highlights before new navigation
    highlightManager.clearAllHighlights();
  }
}

export type { 
  DMTabType, 
  PlayerTabType, 
  AllTabTypes, 
  ModalControls,
  CatalogControls,
  NavigationResult,
  SearchResultType,
  NavigationLocation,
  CatalogRecipientType,
  CatalogContentType
};