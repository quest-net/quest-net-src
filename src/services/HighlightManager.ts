// src/services/HighlightManager.ts

export interface HighlightOptions {
    duration?: number;
    className?: string;
  }
  
  class HighlightManager {
    private static instance: HighlightManager;
    private highlightTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private highlightClass = 'search-highlight';
    private defaultDuration = 10000; // 3 seconds
  
    private constructor() {}
  
    public static getInstance(): HighlightManager {
      if (!HighlightManager.instance) {
        HighlightManager.instance = new HighlightManager();
      }
      return HighlightManager.instance;
    }
  
    public highlight(elementId: string, options: HighlightOptions = {}): void {
      const { 
        duration = this.defaultDuration,
        className = this.highlightClass 
      } = options;
  
      // Wait for next tick to ensure element exists after tab change
      setTimeout(() => {
        const element = document.getElementById(elementId);
        if (!element) {
          console.warn(`Element with id ${elementId} not found for highlighting`);
          return;
        }
  
        // Clear any existing highlight on this element
        this.clearHighlight(elementId);
  
        // Add highlight class
        element.classList.add(className);
  
        // Set timeout to remove highlight
        const timeout = setTimeout(() => {
          this.clearHighlight(elementId, className);
        }, duration);
  
        this.highlightTimeouts.set(elementId, timeout);
      }, 100); // Slightly longer delay to ensure DOM updates
    }
  
    public clearHighlight(elementId: string, className: string = this.highlightClass): void {
      // Clear timeout if exists
      const timeout = this.highlightTimeouts.get(elementId);
      if (timeout) {
        clearTimeout(timeout);
        this.highlightTimeouts.delete(elementId);
      }
  
      // Remove highlight class if element exists
      const element = document.getElementById(elementId);
      if (element) {
        element.classList.remove(className);
      }
    }
  
    public clearAllHighlights(): void {
      // Clear all timeouts
      this.highlightTimeouts.forEach((timeout) => clearTimeout(timeout));
      this.highlightTimeouts.clear();
  
      // Remove highlight class from all elements
      document.querySelectorAll(`.${this.highlightClass}`).forEach((element) => {
        element.classList.remove(this.highlightClass);
      });
    }
  }
  
  export const highlightManager = HighlightManager.getInstance();