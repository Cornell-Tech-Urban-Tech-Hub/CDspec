import * as React from 'react';
const { useState, useEffect, useRef } = React;
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';
import { MapProvider, useMapContext } from './MapContext';
import mapCleanupManager from '../../utils/mapCleanup';
import { createCdPerimeters, createCdPolygons, calculateBoundingBox } from '../../utils/mapUtils';
import mapEventManager from '../../utils/mapEvents';

// Type declarations for window extensions
declare global {
  interface Window {
    mapFunctions?: Record<string, any>;
  }
}

// Type for bounding box
type BoundingBox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

interface MapVisualizerProps {
  projectCDs: string[];
  focusCD?: string | null;
  height?: string;
  initialZoom?: number;
  mapId?: string;
  CDToSlugMap?: Record<string, string>;
}

interface DeckGLMapProps {
  projectCDs: string[];
  focusCD?: string | null;
  initialZoom: number;
  onZoomChange: (zoom: number) => void;
  mapId: string;
  mapContainerId: string;
  mapLibreId: string;
  tooltipId: string;
  CDToSlugMap: Record<string, string>;
  onMapLoaded?: () => void;
}

// Main exported component
export default function MapVisualizer({ 
  projectCDs = [], 
  focusCD = null, 
  height = '500px',
  initialZoom = 14,
  mapId = 'default-map',
  CDToSlugMap = {}
}: MapVisualizerProps) {
  const zoomLevelRef = useRef(initialZoom);
  const [mapLoading, setMapLoading] = useState(true);
  
  const handleZoom = (newZoom: number) => {
    zoomLevelRef.current = newZoom;
  };

  const mapContainerId = `map-container-${mapId}`;
  const mapLibreId = `maplibre-map-${mapId}`;
  const tooltipId = `deck-tooltip-${mapId}`;
  const mapHeight = mapId === 'home-page-map' ? '55vh' : height;

  const handleMapLoaded = () => {
    setTimeout(() => {
      setMapLoading(false);
    }, 300);
  };

  return (
    <MapProvider>
      <div className="relative">
        <div 
          className={`absolute inset-0 bg-card rounded-lg border flex items-center justify-center z-10 transition-opacity duration-500 ${mapLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ height: mapHeight }}
          aria-hidden={!mapLoading}
        >
          <div className="flex flex-col items-center space-y-4">
            <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
            <p className="text-sm text-muted-foreground">Loading map visualization...</p>
          </div>
        </div>
        
        <div 
          id={mapContainerId} 
          className={`w-full bg-card rounded-lg border relative transition-opacity duration-500 ${mapLoading ? 'opacity-0' : 'opacity-100'}`}
          style={{ height: mapHeight }}
        ></div>
        
        <p className={`text-center text-sm text-muted-foreground ${mapId === 'home-page-map' ? 'mt-2' : 'mt-4'} ${mapLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}>
          Interactive map of NYC Community Districts
          {focusCD && <span className="font-medium"> • Focused on: {focusCD}</span>}
        </p>
        
        <DeckGLMap 
          projectCDs={projectCDs} 
          focusCD={focusCD} 
          initialZoom={initialZoom}
          onZoomChange={handleZoom}
          mapId={mapId}
          mapContainerId={mapContainerId}
          mapLibreId={mapLibreId}
          tooltipId={tooltipId}
          CDToSlugMap={CDToSlugMap}
          onMapLoaded={handleMapLoaded}
        />
      </div>
    </MapProvider>
  );
}

function DeckGLMap({ 
  projectCDs, 
  focusCD, 
  initialZoom, 
  onZoomChange,
  mapId,
  mapContainerId,
  mapLibreId,
  tooltipId,
  CDToSlugMap,
  onMapLoaded
}: DeckGLMapProps) {
  if (typeof window === 'undefined') return null;
  
  const { 
    mapInstance, 
    setMapInstance, 
    mapInitialized, 
    setMapInitialized,
    geojsonData,
    setGeojsonData,
    deckOverlay,
    setDeckOverlay,
    tooltipRef,
    registerTooltip
  } = useMapContext();

  const isMounted = useRef(true);
  const isZooming = useRef(false);
  const isNavigatingToCD = useRef(false);
  const currentMapRef = useRef<any>(null);
  const currentOverlayRef = useRef<any>(null);
  const mapLoadedRef = useRef(false);

  // Navigation and event handling
  useEffect(() => {
    window.mapFunctions = window.mapFunctions || {};
    window.mapFunctions[mapId] = {};

    const handleCDNavigation = (cdName: string, options?: any) => {
      try {
        if (!cdName || !currentMapRef.current) return;
        
        console.log(`Navigation requested to CD: ${cdName} on map: ${mapId}`);
        
        isNavigatingToCD.current = true;
        
        if (typeof document !== 'undefined' && currentOverlayRef.current) {
          document.body.classList.add('map-navigating');
          
          setTimeout(() => {
            document.body.classList.remove('map-navigating');
            isNavigatingToCD.current = false;
          }, 1500);
        }
        
        if (!geojsonData && typeof window !== 'undefined') {
          console.log('GeoJSON data not loaded yet, attempting to load');
          
          fetch(`/data/cds_nyc.geojson`)
            .then(response => {
              if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
              return response.json();
            })
            .then(data => {
              setGeojsonData(data);
              navigateToCD(data, cdName, options);
            })
            .catch(error => console.error('Error loading CD data:', error));
        } else {
          navigateToCD(geojsonData, cdName, options);
        }
      } catch (error) {
        console.error('Error handling CD navigation:', error);
        isNavigatingToCD.current = false;
      }
    };
    
    const navigateToCD = (data: any, cdName: string, options?: any) => {
      if (!data || !cdName || !currentMapRef.current) return;
      
      const CDFeature = data.features.find(
        (feature: any) => feature.properties?.cdCode === cdName
      );
      
              if (CDFeature && CDFeature.geometry) {
          const bbox = calculateBoundingBox(CDFeature) as BoundingBox;
        
        let zoomLevel = 14;
        const useDynamicZoom = options?.dynamicZoom === true;
        
        if (useDynamicZoom) {
          const latDiff = Math.abs(bbox.maxLat - bbox.minLat);
          const lngDiff = Math.abs(bbox.maxLng - bbox.minLng);
          
          if (Math.max(latDiff, lngDiff) > 0.03) {
            zoomLevel = 13;
          } else if (Math.max(latDiff, lngDiff) > 0.015) {
            zoomLevel = 14;
          } else {
            zoomLevel = 15;
          }
        }
        
        currentMapRef.current.flyTo({
          center: [
            (bbox.minLng + bbox.maxLng) / 2,
            (bbox.minLat + bbox.maxLat) / 2
          ],
          zoom: zoomLevel,
          duration: 1500,
          essential: true,
          curve: 1.5,
          easing(t: number) {
            return t < 0.5 
              ? 4 * t * t * t 
              : 1 - Math.pow(-2 * t + 2, 3) / 2;
          },
          animate: true
        });
        
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('map-navigation-started', {
            detail: { cdName, mapId }
          }));
        }
        
        if (mapId === 'home-page-map') {
          setTimeout(() => {
            const pillSelector = `.map-nav-pill[data-CD="${cdName}"]`;
            const pill = document.querySelector(pillSelector);
            if (pill) {
              document.querySelectorAll('.map-nav-pill').forEach(p => 
                p.classList.remove('active'));
              pill.classList.add('active');
            }
          }, 0);
        }
      }
    };
    
    const registrationSuccess = mapEventManager.registerNavigationHandler(mapId, handleCDNavigation);
    console.log(`Registered navigation handler for map: ${mapId}, success: ${registrationSuccess}`);
    
    const handleNavigateToCD = (e: any) => {
      if (e.detail?.mapId === mapId) {
        handleCDNavigation(e.detail.cdCode, {
          dynamicZoom: e.detail.dynamicZoom === true
        });
      }
    };

    window.addEventListener('navigateToCD', handleNavigateToCD);

    return () => {
      if (window.mapFunctions && window.mapFunctions[mapId]) {
        delete window.mapFunctions[mapId];
      }
      
      mapEventManager.unregisterNavigationHandler(mapId);
      window.removeEventListener('navigateToCD', handleNavigateToCD);
      console.log(`Unregistered navigation handler for map: ${mapId}`);
    };
  }, [mapId, tooltipId, projectCDs, geojsonData, setGeojsonData]);

  // Cleanup registration
  useEffect(() => {
    return () => {
      if (currentMapRef.current) {
        mapCleanupManager.registerMap(mapId, currentMapRef.current);
      }
      if (currentOverlayRef.current) {
        mapCleanupManager.registerOverlay(mapId, currentOverlayRef.current);
      }
    };
  }, [mapId]);

  // Main map initialization
  useEffect(() => {
    const loadDeckGL = async () => {
      try {
        const [
          { GeoJsonLayer },
          { MapboxOverlay },
          maplibregl
        ] = await Promise.all([
          import('@deck.gl/layers'),
          import('@deck.gl/mapbox'),
          import('maplibre-gl')
        ]);
        
        if (!isMounted.current) return;
        
        const mapContainer = document.getElementById(mapContainerId);
        if (!mapContainer) {
          console.error(`Map container not found: ${mapContainerId}`);
          return;
        }

        // Load saved state
        let savedState = null;
        try {
          const savedMapKey = `map-state-${mapId}`;
          if (typeof sessionStorage !== 'undefined') {
            const storedState = sessionStorage.getItem(savedMapKey);
            if (storedState) {
              savedState = JSON.parse(storedState);
            }
          }
        } catch (e) {
          console.warn('Error accessing sessionStorage:', e);
        }

        // Setup tooltip
        let tooltip = document.getElementById(tooltipId);
        if (!tooltip) {
          tooltip = document.createElement('div');
          tooltip.id = tooltipId;
          tooltip.style.display = 'none';
          tooltip.style.position = 'absolute';
          tooltip.style.zIndex = '1000';
          tooltip.style.pointerEvents = 'none';
          mapContainer.appendChild(tooltip);
          
          registerTooltip(mapId, tooltip as HTMLDivElement);
          
          if (tooltipRef && !tooltipRef.current) {
            tooltipRef.current = tooltip as HTMLDivElement;
          }
          
          tooltip.classList.add('map-tooltip');
          tooltip.setAttribute('data-map-id', mapId);
        }

        // Load geojson data
        let CDData = geojsonData;
        if (!CDData) {
          const response = await fetch(`/data/cds_nyc.geojson`);
          if (!response.ok) {
            throw new Error(`Failed to fetch GeoJSON: ${response.status} ${response.statusText}`);
          }
          CDData = await response.json();
          setGeojsonData(CDData);
        }

        // Calculate view state
        let viewState = savedState?.viewState || {
          latitude: 40.7128,
          longitude: -74.0060,
          zoom: initialZoom,
          pitch: 0,
          bearing: 0
        };

        if (focusCD && CDData) {
          const focusFeature = CDData.features.find(
            (feature: any) => feature.properties?.cdCode === focusCD
          );
          
          if (focusFeature && focusFeature.geometry) {
            if (focusFeature.geometry.type === 'Polygon' || focusFeature.geometry.type === 'MultiPolygon') {
              const bbox = calculateBoundingBox(focusFeature) as BoundingBox;
              viewState = {
                ...viewState,
                latitude: (bbox.maxLat + bbox.minLat) / 2,
                longitude: (bbox.maxLng + bbox.minLng) / 2,
                zoom: initialZoom
              };
            }
          }
        }

        // Initialize map
        let map = currentMapRef.current;
        
        if (!map) {
          while (mapContainer.firstChild) {
            mapContainer.removeChild(mapContainer.firstChild);
          }
          
          const mapRoot = document.createElement('div');
          mapRoot.id = mapLibreId;
          mapRoot.style.width = '100%';
          mapRoot.style.height = '100%';
          mapRoot.style.borderRadius = '0.5rem';
          mapContainer.appendChild(mapRoot);
          mapContainer.appendChild(tooltip);
          
          map = new maplibregl.Map({
            container: mapLibreId,
            style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            center: [viewState.longitude, viewState.latitude],
            zoom: viewState.zoom,
            bearing: viewState.bearing,
            pitch: viewState.pitch,
            minZoom: 9,
            renderWorldCopies: false,
            fadeDuration: 0
          });
          
          currentMapRef.current = map;
          if (mapId === 'default-map') {
            setMapInstance(map);
          }
          
          mapCleanupManager.registerMap(mapId, map);
          
          // Map event handlers
          map.on('movestart', () => {
            isZooming.current = true;
            if (tooltip) tooltip.style.display = 'none';
          });
          
          map.on('moveend', () => {
            isZooming.current = false;
            if (map) {
              const currentZoom = map.getZoom();
              onZoomChange(currentZoom);
              
              try {
                if (typeof sessionStorage !== 'undefined') {
                  const center = map.getCenter();
                  const state = {
                    viewState: {
                      latitude: center.lat,
                      longitude: center.lng,
                      zoom: currentZoom,
                      pitch: map.getPitch(),
                      bearing: map.getBearing()
                    },
                    timestamp: Date.now()
                  };
                  sessionStorage.setItem(`map-state-${mapId}`, JSON.stringify(state));
                }
              } catch (e) {
                console.warn('Error saving map state:', e);
              }
            }
          });
          
          map.on('load', () => {
            mapLoadedRef.current = true;
            
            if (onMapLoaded && typeof onMapLoaded === 'function') {
              onMapLoaded();
            }
            
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('map-loaded', {
                detail: { mapId }
              }));
            }
          });
          
          map.on('style.load', () => {
            if (!CDData) return;
            
            if (mapId === 'default-map') {
              setMapInitialized(true);
            }
            
            setupMapLayers(
              map, 
              CDData, 
              projectCDs, 
              focusCD, 
              MapboxOverlay, 
              GeoJsonLayer, 
              tooltip,
              (overlay: any) => {
                currentOverlayRef.current = overlay;
                if (mapId === 'default-map') {
                  setDeckOverlay(overlay);
                }
              },
              mapId,
              tooltipId,
              CDToSlugMap
            );

            if (currentOverlayRef.current) {
              mapCleanupManager.registerOverlay(mapId, currentOverlayRef.current);
            }
          });
        }
      } catch (error) {
        console.error("Error initializing Deck.gl map:", error);
      }
    };
    
    loadDeckGL();
    
    return () => {
      if (currentMapRef.current) {
        try {
          if (currentOverlayRef.current) {
            try {
              currentMapRef.current.removeControl(currentOverlayRef.current);
            } catch (e) {
              console.warn(`Error removing deck overlay for map ${mapId}:`, e);
            }
            currentOverlayRef.current = null;
          }
          
          const map = currentMapRef.current;
          map.off();
          
          if (document.getElementById(mapContainerId)) {
            map.remove();
          }
          
          currentMapRef.current = null;
        } catch (e) {
          console.warn(`Error cleaning up map ${mapId}:`, e);
        }
      }
    };
  }, [projectCDs, focusCD, mapContainerId, mapLibreId, tooltipId, mapId]);
  
  return null;
}

// Enhanced tooltip styling
function getEnhancedTooltipStyle(isActive = false) {
  return {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: isActive 
      ? '0 4px 14px rgba(0,0,0,0.15), 0 0 0 2px rgba(16, 185, 129, 0.4)' 
      : '0 2px 10px rgba(0,0,0,0.1)',
    padding: '10px 14px',
    fontSize: '14px',
    lineHeight: '1.5',
    transition: 'all 0.2s ease',
    transform: isActive ? 'translateY(-5px)' : 'translateY(0)',
    opacity: 1,
    border: isActive ? '1px solid rgba(16, 185, 129, 0.6)' : '1px solid rgba(0,0,0,0.05)'
  };
}

// Shared layer creation function
function createMapLayers(geojsonData: any, projectCDs: string[], focusCD: string | null | undefined, GeoJsonLayer: any, mapId: string, firstLabelLayerId?: string) {
  const layerIdPrefix = `${mapId}-${Date.now()}-`;
  
  // Process geometries
  let cdPerimeters, cdPolygons;
  try {
    cdPerimeters = createCdPerimeters(geojsonData);
    cdPolygons = createCdPolygons(geojsonData);
  } catch (error) {
    console.error("Error processing CD geometries:", error);
    cdPerimeters = [];
    cdPolygons = [];
  }

  const layers = [];
  
  // Main fill layer
  if (geojsonData.features.length > 0) {
    layers.push(
      new GeoJsonLayer({
        id: `${layerIdPrefix}cd-layer`,
        data: geojsonData,
        pickable: false,
        stroked: true,
        filled: true,
        extruded: false,
        beforeId: firstLabelLayerId,
        getFillColor: (d: any) => {
          const cdCode = d.properties?.cdCode;
          const hasProject = cdCode && projectCDs.includes(cdCode);
          const isFocused = cdCode && focusCD === cdCode;
          
          if (isFocused) return [5, 150, 105, 180]; 
          if (hasProject) return [16, 185, 129, 150]; 
          return [59, 130, 246, 150]; 
        },
        getLineColor: [0, 0, 0, 0],
        getLineWidth: 0,
        parameters: {
          depthTest: false,
          zIndex: 1
        },
        updateTriggers: {
          getFillColor: [projectCDs.join(','), focusCD]
        },
        transitions: {
          getFillColor: {
            duration: 300,
            easing: (t: number) => t * (2 - t)
          }
        }
      })
    );
  }

  // Perimeter layer
  if (cdPerimeters.length > 0) {
    layers.push(
      new GeoJsonLayer({
        id: `${layerIdPrefix}cd-perimeter-layer`,
        data: cdPerimeters,
        pickable: false,
        stroked: false,
        filled: false,
        lineWidthUnits: 'pixels',
        getLineColor: (d: any) => {
          const cdCode = d.properties?.cdCode;
          const hasProject = cdCode && projectCDs.includes(cdCode);
          const isFocused = cdCode && focusCD === cdCode;
          
          if (isFocused) return [4, 120, 87, 255]; 
          if (hasProject) return [16, 185, 129, 255];
          return [30, 64, 175, 255]; 
        },
        getLineWidth: (d: any) => {
          const cdCode = d.properties?.cdCode;
          const hasProject = cdCode && projectCDs.includes(cdCode);
          const isFocused = cdCode && focusCD === cdCode;
          
          if (isFocused) return 4;
          if (hasProject) return 3;
          return 2;
        },
        parameters: {
          depthTest: false,
          zIndex: 2
        },
        updateTriggers: {
          getLineColor: [projectCDs.join(','), focusCD],
          getLineWidth: [projectCDs.join(','), focusCD]
        },
        transitions: {
          getLineColor: {
            duration: 500,
            easing: (t: number) => t * (2 - t)
          },
          getLineWidth: {
            duration: 300,
            easing: (t: number) => t * (2 - t)
          }
        }
      })
    );
  }

  // Interaction layer
  if (cdPolygons.length > 0) {
    layers.push(
      new GeoJsonLayer({
        id: `${layerIdPrefix}cd-interaction-layer`,
        data: cdPolygons,
        pickable: true,
        stroked: false,
        filled: true,
        getFillColor: [0, 0, 0, 0],
        parameters: {
          depthTest: false,
          zIndex: 3
        }
      })
    );
  }
  
  return layers;
}

// Shared interaction handlers with optimized hover behavior
function createInteractionHandlers(projectCDs: string[], tooltipId: string, CDToSlugMap: Record<string, string>, mapId: string) {
  // Track the currently hovered CD to avoid unnecessary updates
  let currentHoveredCd: string | null = null;
  
  return {
    onClick: (info: any) => {
      if (!info || !info.object) return;
      
      const cdCode = info.object.properties?.cdCode;
      if (!cdCode) return;
      
      const hasProject = projectCDs.includes(cdCode);
      
      if (typeof document !== 'undefined') {
        document.body.classList.add('map-interaction');
        
        setTimeout(() => {
          document.body.classList.remove('map-interaction');
        }, 500);
      }
      
      if (hasProject && CDToSlugMap && CDToSlugMap[cdCode]) {
        const projectSlug = CDToSlugMap[cdCode];
        window.location.href = `/projects/${projectSlug}`;
      }
    },
    onHover: (info: any) => {
      const tooltip = document.getElementById(tooltipId);
      
      if (!tooltip) return;
      
      // Handle mouse leaving all features
      if (!info || !info.object) {
        if (currentHoveredCd !== null) {
          currentHoveredCd = null;
          tooltip.style.opacity = '0';
          tooltip.style.transform = 'translate(-50%, -100%) translateY(-5px)';
          
          setTimeout(() => {
            if (tooltip) tooltip.style.display = 'none';
          }, 200);
        }
        return;
      }
      
      const cdCode = info.object.properties?.cdCode;
      if (!cdCode) {
        if (currentHoveredCd !== null) {
          currentHoveredCd = null;
          tooltip.style.display = 'none';
        }
        return;
      }
      
      // Only update tooltip if we're hovering a different CD
      if (currentHoveredCd === cdCode) {
        // Just update position for the same CD
        tooltip.style.left = `${info.x}px`;
        tooltip.style.top = `${info.y}px`;
        return;
      }
      
      // We're entering a new CD
      currentHoveredCd = cdCode;
      
      const getCdDisplayName = (cdCode: string) => {
        const borough = cdCode.charAt(0);
        const cdNumber = cdCode.substring(1);
        const boroughNames: Record<string, string> = {
          '1': 'Manhattan',
          '2': 'Bronx', 
          '3': 'Brooklyn',
          '4': 'Queens',
          '5': 'Staten Island'
        };
        return `${boroughNames[borough] || 'Unknown'} CD ${parseInt(cdNumber)}`;
      };
      
      const cdDisplayName = getCdDisplayName(cdCode);
      const hasProject = projectCDs.includes(cdCode);
      
      tooltip.style.display = 'block';
      tooltip.style.left = `${info.x}px`;
      tooltip.style.top = `${info.y}px`;
      tooltip.style.transform = 'translate(-50%, -100%) translateY(-10px)';
      tooltip.style.marginTop = '-10px';
      tooltip.style.opacity = '0';
      tooltip.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out';
      
      // Update tooltip content
      tooltip.innerHTML = `
        <div class="tooltip-content" style="
          font-family: system-ui, sans-serif; 
          padding: 10px 14px; 
          background: white; 
          border-radius: 8px; 
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          border: ${hasProject ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(0,0,0,0.05)'};
          transition: all 0.2s ease;
        ">
          <strong>${cdDisplayName}</strong>
          ${hasProject ? 
            `<p style="
              color: #10B981; 
              margin-top: 4px; 
              margin-bottom: 0;
              display: flex;
              align-items: center;
            ">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width: 14px; height: 14px; margin-right: 4px;">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
              </svg>
              Has project analysis
              ${CDToSlugMap && CDToSlugMap[cdCode] ? 
                `<span style="font-size: 12px; margin-left: 4px; opacity: 0.8;">(click to view)</span>` : 
                ''}
            </p>` : 
            `<p style="
              color: #6B7280; 
              margin-top: 4px; 
              margin-bottom: 0;
              display: flex;
              align-items: center;
            ">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width: 14px; height: 14px; margin-right: 4px; opacity: 0.5;">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" />
              </svg>
              No analysis yet
            </p>`}
        </div>
      `;
      
      // Animate in
      requestAnimationFrame(() => {
        tooltip.style.opacity = '1';
        tooltip.style.transform = 'translate(-50%, -100%) translateY(0)';
      });
    }
  };
}

// Setup map layers
async function setupMapLayers(
  map: any, 
  geojsonData: any, 
  projectCDs: string[], 
  focusCD: string | null | undefined, 
  MapboxOverlay: any, 
  GeoJsonLayer: any, 
  tooltip: HTMLElement, 
  setDeckOverlay: (overlay: any) => void, 
  mapId: string,
  tooltipId: string,
  CDToSlugMap: Record<string, string>
) {
  try {
    if (!map || !geojsonData) {
      console.error("Missing required parameters for setupMapLayers");
      return;
    }
    
    if (typeof document !== 'undefined') {
      const mapContainer = document.getElementById(`map-container-${mapId}`);
      if (!mapContainer) {
        console.log(`Map container for ${mapId} no longer exists, aborting layer setup`);
        return;
      }
    }
    
    const mapStyle = map.getStyle();
    if (!mapStyle || !mapStyle.layers) {
      console.error("Map style or layers not available");
      return;
    }
    
    if (!Array.isArray(geojsonData.features)) {
      console.error("Invalid geojsonData structure - features array missing");
      return;
    }

    const firstLabelLayer = mapStyle.layers.find((layer: any) => 
      layer && (layer.type === 'symbol' || (layer.id && (layer.id.includes('label') || layer.id.includes('place'))))
    );
    
    const firstLabelLayerId = firstLabelLayer?.id;

    const layers = createMapLayers(geojsonData, projectCDs, focusCD, GeoJsonLayer, mapId, firstLabelLayerId);
    
    if (layers.length === 0) {
      console.warn("No valid layers to render");
      return;
    }
  
    const handlers = createInteractionHandlers(projectCDs, tooltipId, CDToSlugMap, mapId);
    
    const deckOverlay = new MapboxOverlay({
      interleaved: true,
      layers,
      onError: (error: any) => {
        console.error(`Deck.gl error in map ${mapId}:`, error);
      },
      ...handlers
    });
    
    setDeckOverlay(deckOverlay);
    (deckOverlay as any)._createdAt = Date.now();
    (deckOverlay as any)._mapId = mapId;
    
    try {
      if (typeof document !== 'undefined') {
        const mapElement = document.getElementById(`maplibre-map-${mapId}`);
        if (!mapElement) {
          console.warn(`Map element ${mapId} no longer exists, skipping overlay`);
          return;
        }
      }
      
      map.addControl(deckOverlay);
      console.log(`Created ${layers.length} layers for map ${mapId}`);
    } catch (error) {
      console.error("Error adding deck overlay to map:", error);
    }
  } catch (error) {
    console.error("Error setting up map layers:", error);
  }
}

// Update map layers
function updateMapLayers(
  deckOverlay: any, 
  geojsonData: any, 
  projectCDs: string[], 
  focusCD: string | null | undefined, 
  GeoJsonLayer: any, 
  tooltip: HTMLElement, 
  mapId: string,
  tooltipId: string,
  CDToSlugMap: Record<string, string>
) {
  try {
    if (typeof document !== 'undefined') {
      const mapContainer = document.getElementById(`map-container-${mapId}`);
      if (!mapContainer) {
        console.log(`Map container for ${mapId} no longer exists, aborting update`);
        return;
      }
    }
    
    if (!deckOverlay || !geojsonData || !Array.isArray(geojsonData.features)) {
      console.error("Invalid params for updateMapLayers");
      return;
    }

    const layers = createMapLayers(geojsonData, projectCDs, focusCD, GeoJsonLayer, mapId);
    const handlers = createInteractionHandlers(projectCDs, tooltipId, CDToSlugMap, mapId);
    
    if (layers.length === 0) {
      console.warn("No valid layers to update");
      return;
    }
    
    try {
      if (!(deckOverlay as any)._mapId || (deckOverlay as any)._mapId !== mapId) {
        console.warn('Overlay appears to be stale or from different map, aborting update');
        return;
      }
      
      deckOverlay.setProps({
        layers,
        onError: (error: any) => {
          console.error(`Deck.gl error in map ${mapId}:`, error);
        },
        ...handlers
      });
      
      console.log(`Updated ${layers.length} layers for map ${mapId}`);
    } catch (error) {
      console.error("Error updating deck overlay props:", error);
    }
  } catch (error) {
    console.error("Error updating map layers:", error);
  }
}

