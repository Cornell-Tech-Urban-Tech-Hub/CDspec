/**
 * Centralized event manager for map navigation
 * Handles communication between map components and navigation events
 */
class MapEventManager {
  constructor() {
    this.handlers = {};
    this._isReady = false;
    this.setupGlobalHandler();
  }
  
  setupGlobalHandler() {
    // Clean up any existing handlers first to prevent duplicates
    if (typeof window !== 'undefined') {
      window.removeEventListener('navigateToCD', this._navigationHandler);
    }
    
    // Store the handler as a property to allow proper removal
    this._navigationHandler = (event) => {
      const { mapId, cdCode } = event.detail || {};
      
      // Check if the map's DOM element still exists before handling event
      if (mapId && typeof document !== 'undefined') {
        const mapContainer = document.getElementById(`map-container-${mapId}`);
        if (!mapContainer) {
          console.log(`MapEventManager: Ignoring event for non-existent map: ${mapId}`);
          return;
        }
      }
      
      if (mapId && cdCode && this.handlers[mapId]) {
        console.log(`MapEventManager: Navigation to CD ${cdCode} on map ${mapId}`);
        this.handlers[mapId](cdCode);
      } else {
        if (!mapId) console.warn('MapEventManager: Missing mapId in event');
        if (!cdCode) console.warn('MapEventManager: Missing cdCode in event');
        if (mapId && !this.handlers[mapId]) console.warn(`MapEventManager: No handler for ${mapId}`);
      }
    };
    
    // Listen for the custom map navigation event
    if (typeof window !== 'undefined') {
      window.addEventListener('navigateToCD', this._navigationHandler);
      
      // Make the manager available globally
      window.MapEventManager = this;
      
      // Set up initialization check
      document.addEventListener('DOMContentLoaded', () => {
        console.log('MapEventManager: Ready to handle map navigation events');
        this._isReady = true;
      });
    }
  }

  registerNavigationHandler(mapId, handler) {
    if (!mapId || !handler) {
      console.warn('MapEventManager: Invalid registration parameters');
      return false;
    }
    
    this.handlers[mapId] = handler;
    console.log(`MapEventManager: Registered handler for map ${mapId}`);
    return true;
  }
  
  unregisterNavigationHandler(mapId) {
    if (this.handlers[mapId]) {
      delete this.handlers[mapId];
      console.log(`MapEventManager: Unregistered handler for map ${mapId}`);
    }
  }
  
  cleanup() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('navigateToCD', this._navigationHandler);
    }
    this.handlers = {};
    this._isReady = false;
  }

  // Helper method to navigate directly to a CD project
  navigateToCdProject(cdCode, cdToSlugMap) {
    if (!cdCode || !cdToSlugMap || !cdToSlugMap[cdCode]) {
      console.warn(`MapEventManager: Cannot navigate to CD project: missing slug for ${cdCode}`);
      return false;
    }
    
    try {
      const projectSlug = cdToSlugMap[cdCode];
      
      // Get base path using same method as in MapVisualizer
      const getBasePath = () => {
        // Check for base path in Astro configuration
        if (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) {
          return import.meta.env.BASE_URL;
        }
        
        // Fallback approach for client-side detection
        if (typeof document !== 'undefined') {
          const baseElement = document.querySelector('base');
          if (baseElement && baseElement.href) {
            try {
              const url = new URL(baseElement.href);
              const pathParts = url.pathname.split('/').filter(Boolean);
              if (pathParts.length > 0) {
                return `/${pathParts.join('/')}`;
              }
            } catch (e) {
              console.warn('Error parsing base URL:', e);
            }
          }
          
          // Check for Astro's script data
          const astroData = document.querySelector('script[data-astro-repo-base]');
          if (astroData && astroData.dataset.astroRepoBase) {
            return astroData.dataset.astroRepoBase;
          }
        }

        
        return '/';
      };
      
      const baseUrl = getBasePath();
      
      console.log(`MapEventManager: Navigating to CD project ${cdCode} (${projectSlug}) at ${baseUrl}/projects/${projectSlug}`);
      window.location.href = `${baseUrl}/projects/${projectSlug}`;
      return true;
    } catch (error) {
      console.error(`MapEventManager: Error navigating to CD project ${cdCode}:`, error);
      return false;
    }
  }
}

// Create and export a singleton instance
const mapEventManager = new MapEventManager();

export default mapEventManager;
