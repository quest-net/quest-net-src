class ScrollManager {
    private static instance: ScrollManager;
    
    public static getInstance(): ScrollManager {
      if (!ScrollManager.instance) {
        ScrollManager.instance = new ScrollManager();
      }
      return ScrollManager.instance;
    }
  
    public scrollToElement(elementId: string): void {
      
      
      setTimeout(() => {
        const element = document.getElementById(elementId);
        if (!element) {
          
          return;
        }
  
        // Find the closest parent with 'scrollable' class
        const container = element.closest('.scrollable');
        if (!container) {
          
          return;
        }
  
        // Get element and container positions
        const elementRect = element.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
  
        // Calculate relative position
        const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
  
        
  
        container.scrollTo({
          top: relativeTop - 20, // 20px offset from top
          behavior: 'smooth'
        });
  
        
      }, 100);
    }
  }
  
  export const scrollManager = ScrollManager.getInstance();