import * as React from 'react';
const { useState, useEffect, useRef, useMemo, useCallback } = React;
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapProvider, useMapContext } from './MapContext';
import mapCleanupManager from '../../utils/mapCleanup';
import { createCdPerimeters, calculateBoundingBox } from '../../utils/mapUtils';
import mapEventManager from '../../utils/mapEvents';
import * as turf from '@turf/turf';
const center = turf.center;

// Static imports for better stability with client:only
import { GeoJsonLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import maplibregl from 'maplibre-gl';

// Performance: Throttle function for hover events
function throttle<T extends (...args: any[]) => any>(func: T, limit: number): T {
  let inThrottle = false;
  let lastArgs: Parameters<T> | null = null;
  
  return ((...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        if (lastArgs) {
          func(...lastArgs);
          lastArgs = null;
        }
      }, limit);
    } else {
      lastArgs = args;
    }
  }) as T;
}

// Type declarations for window extensions
declare global {
  interface Window {
    mapFunctions?: Record<string, any>;
  }
}

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
  CDToSlugMap: Record<string, string>;
  onMapLoaded?: () => void;
}

export default function MapVisualizer({ 
  projectCDs = [], 
  focusCD = null, 
  height = '500px',
  initialZoom = 13, // Slightly zoomed out for 3D view
  mapId = 'default-map',
  CDToSlugMap = {}
}: MapVisualizerProps) {
  const zoomLevelRef = useRef(initialZoom);
  const [mapLoading, setMapLoading] = useState(true);
  
  const handleZoom = useCallback((newZoom: number) => {
    zoomLevelRef.current = newZoom;
  }, []);

  const mapContainerId = `map-container-${mapId}`;
  const mapLibreId = `maplibre-map-${mapId}`;
  const mapHeight = mapId === 'home-page-map' ? '100vh' : height;

  const handleMapLoaded = useCallback(() => {
    // Add a small delay to ensure smooth transition
    setTimeout(() => {
      setMapLoading(false);
    }, 500);
  }, []);

  return (
    <MapProvider>
      <div className="relative h-full w-full overflow-hidden rounded-lg">
        <style>{`
          .map-billboard-marker {
            transition: opacity 0.15s ease-out;
          }
          .tooltip-content {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(8px);
            padding: 8px 12px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            border: 1px solid #e5e7eb;
            contain: layout style paint;
          }
          .tooltip-content.active {
            border-color: #10b981;
          }
          .tooltip-content h3 {
            font-size: 14px;
            font-weight: 700;
            color: #111827;
            margin: 0 0 2px 0;
            line-height: 1.2;
          }
          .tooltip-content span {
            font-size: 12px;
            color: #6b7280;
          }
          .tooltip-content.active span {
            color: #10b981;
            font-weight: 500;
          }
          .tooltip-arrow {
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 8px solid white;
            margin: -1px auto 0 auto;
          }
          .tooltip-arrow.active {
            border-top-color: #10b981;
          }
          .maplibregl-canvas {
            outline: none !important;
          }
        `}</style>
        {/* Loading State */}
        <div 
          className={`absolute inset-0 bg-card flex items-center justify-center z-20 transition-opacity duration-700 ${mapLoading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ height: mapHeight }}
          aria-hidden={!mapLoading}
        >
          <div className="flex flex-col items-center space-y-4">
            <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
            <p className="text-sm text-muted-foreground font-medium">Initializing 3D Map...</p>
          </div>
        </div>
        
        {/* Map Container */}
        <div 
          id={mapContainerId} 
          className="w-full h-full relative bg-slate-50"
          style={{ height: mapHeight }}
        >
           {/* MapLibre and DeckGL will be mounted here */}
        </div>
        
        <DeckGLMap 
          projectCDs={projectCDs} 
          focusCD={focusCD} 
          initialZoom={initialZoom}
          onZoomChange={handleZoom}
          mapId={mapId}
          mapContainerId={mapContainerId}
          mapLibreId={mapLibreId}
          CDToSlugMap={CDToSlugMap}
          onMapLoaded={handleMapLoaded}
        />
      </div>
    </MapProvider>
  );
}

// Memoized DeckGLMap to prevent unnecessary React re-renders
const DeckGLMap = React.memo(function DeckGLMap({ 
  projectCDs, 
  focusCD, 
  initialZoom, 
  onZoomChange,
  mapId,
  mapContainerId,
  mapLibreId,
  CDToSlugMap,
  onMapLoaded
}: DeckGLMapProps) {
  if (typeof window === 'undefined') return null;
  
  const { 
    setMapInstance, 
    geojsonData,
    setGeojsonData,
    setDeckOverlay
  } = useMapContext();

  const currentMapRef = useRef<any>(null);
  const currentOverlayRef = useRef<any>(null);
  const markerRef = useRef<any>(null); 
  const markerElRef = useRef<HTMLDivElement | null>(null);
  const lastHoveredCDRef = useRef<string | null>(null);
  
  // Store layers in ref to access them in callbacks without triggering renders
  const baseLayersRef = useRef<any[]>([]);
  
  // Memoize project CDs set for fast lookups
  const projectCDsSet = useMemo(() => {
    return new Set(projectCDs.map(cd => String(cd).trim()));
  }, [projectCDs]);

  // 1. Separate Geometry Calculation
  const cdPerimeters = useMemo(() => {
    if (!geojsonData || !geojsonData.features) return [];
    try {
        return createCdPerimeters(geojsonData);
    } catch (e) {
        console.error("Error generating map geometry:", e);
        return [];
    }
  }, [geojsonData]);

  // 2. MERGED FEATURES (Optimize Picking Performance)
  // Instead of two layers, we prepare one dataset with an "isActive" property
  const mergedFeatures = useMemo(() => {
    if (!geojsonData || !geojsonData.features) return [];

    const features = [];
    for (const f of geojsonData.features) {
      const rawCode = f.properties?.cdCode || f.properties?.boro_cd || f.properties?.BoroCD;
      const cdCode = rawCode ? String(rawCode).trim() : null;
      
      // Create a shallow copy to avoid mutating original data if possible, or just mutate props
      // Just careful mutation for performance
      if (!f.properties) f.properties = {};
      if (!f.properties.cdCode && cdCode) f.properties.cdCode = cdCode;

      f.properties.isActive = cdCode && projectCDsSet.has(cdCode);

      // Pre-calculate centroid for tooltips
      if (!f.properties.centroid) {
        try {
            const c = center(f);
            f.properties.centroid = c.geometry.coordinates;
        } catch(e) {
            // Fallback
        }
      }
      features.push(f);
    }
    return features;
  }, [geojsonData, projectCDsSet]);

  // 3. Initialize Map
  useEffect(() => {
    let isCancelled = false;

    const initMap = async () => {
      if (isCancelled) return;
      const mapContainer = document.getElementById(mapContainerId);
      if (!mapContainer || currentMapRef.current) return;

      if (!geojsonData) {
         try {
            const res = await fetch(`/data/cds_nyc.geojson`);
            if (res.ok) {
              const data = await res.json();
              if (!isCancelled) setGeojsonData(data);
            }
         } catch (e) {
            console.error("Failed to load map data", e);
         }
      }
      
      const mapDiv = document.createElement('div');
      mapDiv.id = mapLibreId;
      mapDiv.style.width = '100%';
      mapDiv.style.height = '100%';
      mapContainer.appendChild(mapDiv);

      const map = new maplibregl.Map({
          container: mapLibreId,
          style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
          center: [-74.0060, 40.7128],
          zoom: initialZoom,
          pitch: 45,
          bearing: -15,
          minZoom: 10,
          maxZoom: 16,
          antialias: false, // Performance: Disable antialiasing for smoother interaction
          fadeDuration: 0, // Performance: Instant tile transitions
          trackResize: true,
          renderWorldCopies: false, // Performance: Don't render world copies
          preserveDrawingBuffer: false, // Performance: Don't preserve buffer
          refreshExpiredTiles: false, // Performance: Reduce tile refresh
      } as any);

      currentMapRef.current = map;
      if (mapId === 'default-map') setMapInstance(map);
      mapCleanupManager.registerMap(mapId, map);

      map.addControl(new maplibregl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
        showZoom: true
      }), 'top-right');

      // Initialize Persistent Marker with GPU-accelerated CSS
      const el = document.createElement('div');
      el.className = 'map-billboard-marker';
      el.style.cssText = `
        pointer-events: none;
        will-change: transform;
        transform: translateZ(0);
        backface-visibility: hidden;
        opacity: 0;
        padding-bottom: 20px;
        contain: layout style paint;
      `;
      markerElRef.current = el;

      // Create marker immediately and keep it alive
      const marker = new maplibregl.Marker({
          element: el,
          anchor: 'bottom',
          offset: [0, -10]
      })
      .setLngLat([-74.0060, 40.7128]) // Dummy init pos
      .addTo(map);
      markerRef.current = marker;


      map.on('load', () => {
          if (!isCancelled && onMapLoaded) onMapLoaded();
      });
      
      // Performance: Use 'moveend' instead of 'move' for less frequent updates
      map.on('moveend', () => {
         if (onZoomChange) onZoomChange(map.getZoom());
      });

      return () => {
        isCancelled = true;
        if (markerRef.current) markerRef.current.remove();
        if (currentMapRef.current) {
             currentMapRef.current.remove();
             currentMapRef.current = null;
        }
      };
    };

    initMap();
    return () => { isCancelled = true; };
  }, [mapId]);

  // 4. Click Handler
  const handleLayerClick = useCallback((info: any) => {
    if (!info?.object) return;
    const cdCode = info.object.properties?.cdCode;
    
    if (cdCode && projectCDsSet.has(String(cdCode).trim()) && CDToSlugMap[cdCode]) {
        const dest = CDToSlugMap[cdCode];
        if (dest.startsWith('http')) {
            window.open(dest, '_blank', 'noopener,noreferrer');
        } else {
            const path = dest.startsWith('/projects/') ? dest : `/projects/${dest}`;
            window.location.href = path;
        }
    }
  }, [projectCDsSet, CDToSlugMap]);

  // 5. Imperative Hover Handler - OPTIMIZED for instant response
  const updateTooltipCore = useCallback((info: any) => {
    const map = currentMapRef.current;
    if (!map) return;

    const hoveredObject = info.object;
    const el = markerElRef.current;
    const marker = markerRef.current;
    const canvas = map.getCanvas();

    if (!el || !marker) return;

    // --- Hide tooltip when not hovering ---
    if (!hoveredObject) {
        if (lastHoveredCDRef.current !== null) {
            el.style.opacity = '0';
            lastHoveredCDRef.current = null;
            // Reset cursor
            if (canvas) canvas.style.cursor = 'grab';
        }
        return;
    }

    const cdCode = hoveredObject.properties?.cdCode;
    const hasProject = hoveredObject.properties?.isActive;
    
    // Update cursor immediately for better feedback
    if (canvas) {
        canvas.style.cursor = hasProject ? 'pointer' : 'grab';
    }
    
    // If same CD, skip DOM updates (critical optimization)
    if (lastHoveredCDRef.current === cdCode) return;
    
    lastHoveredCDRef.current = cdCode;

    // Get position - prefer pre-calculated centroid, fallback to click coords
    let targetPos: [number, number] | null = null;
    if (hoveredObject.properties?.centroid) {
        targetPos = hoveredObject.properties.centroid;
    } else if (info.coordinate) {
        targetPos = [info.coordinate[0], info.coordinate[1]];
    }
    
    if (!targetPos) return;

    // INSTANT positioning - no animation lag
    marker.setLngLat(targetPos);
    el.style.opacity = '1';

    // Optimized DOM Update - minimal reflow
    el.innerHTML = `
      <div class="tooltip-content ${hasProject ? 'active' : ''}">
        <h3>${cdCode || 'District'}</h3>
        <span>${hasProject ? '● Active Project' : 'No active project'}</span>
      </div>
      <div class="tooltip-arrow ${hasProject ? 'active' : ''}"></div>
    `;

  }, []);

  // Throttled version for hover events (16ms = ~60fps max)
  const updateTooltip = useMemo(
    () => throttle(updateTooltipCore, 16),
    [updateTooltipCore]
  );

  // 6. Base Layers Update - OPTIMIZED for performance
  useEffect(() => {
      if (!currentMapRef.current || !geojsonData) return;
      
      const layerPrefix = `${mapId}-layers`;
      
      // Performance: Pre-compute colors as typed arrays for GPU efficiency
      const activeColor: [number, number, number, number] = [16, 185, 129, 20];
      const inactiveColor: [number, number, number, number] = [0, 0, 0, 0];
      const activeLineColor: [number, number, number, number] = [16, 185, 129, 200];
      const inactiveLineColor: [number, number, number, number] = [156, 163, 175, 100];
      
      const commonProps = {
        pickable: true,
        stroked: true,
        filled: true,
        extruded: true,
        wireframe: false, // Performance: Disable wireframe
        lineWidthScale: 1,
        lineWidthMinPixels: 1,
        // Pre-computed colors for faster access
        getFillColor: ((d: any) => d.properties.isActive ? activeColor : inactiveColor) as any,
        getLineColor: ((d: any) => d.properties.isActive ? activeLineColor : inactiveLineColor) as any,
        getElevation: ((d: any) => d.properties.isActive ? 100 : 0) as any,
        autoHighlight: true,
        highlightColor: [16, 185, 129, 50] as [number, number, number, number],
        // Performance: Picking optimization
        pickingRadius: 2, // Smaller radius = faster picking
        parameters: { 
          depthTest: true,
          blend: true,
        },
        onClick: handleLayerClick,
        onHover: updateTooltip,
        updateTriggers: {
            getLineColor: [projectCDs],
            getFillColor: [projectCDs],
            getElevation: [projectCDs]
        }
      };

      const layers = [];

      // Combined Layer for better Picking Performance (1 pass instead of 2)
      if (mergedFeatures.length > 0) {
          layers.push(new GeoJsonLayer({
              ...commonProps,
              id: `${layerPrefix}-merged`,
              data: mergedFeatures,
              // Performance: Material settings for simpler rendering
              material: {
                ambient: 0.5,
                diffuse: 0.5,
                shininess: 0,
                specularColor: [0, 0, 0]
              }
          }));
      }

      // Outlines (Not pickable) - simplified
      if (cdPerimeters.length > 0) {
          layers.push(new GeoJsonLayer({
              id: `${layerPrefix}-outlines`,
              data: cdPerimeters,
              pickable: false,
              stroked: true,
              filled: false,
              lineWidthUnits: 'pixels',
              getLineColor: (d: any) => {
                 const cd = d.properties?.cdCode;
                 return projectCDsSet.has(cd) ? [16, 185, 129, 255] : [100, 100, 100, 100];
              },
              getLineWidth: (d: any) => {
                  const cd = d.properties?.cdCode;
                  return projectCDsSet.has(cd) ? 3 : 1;
              },
              parameters: { depthTest: false },
              updateTriggers: {
                  getLineColor: [projectCDs],
                  getLineWidth: [projectCDs]
              }
          }));
      }

      baseLayersRef.current = layers;

      // Initial overlay setup or update
      if (!currentOverlayRef.current) {
          const overlay = new MapboxOverlay({ 
              interleaved: true, 
              layers,
              // Performance: Reduce picking overhead
              _pickable: true,
          });
          currentOverlayRef.current = overlay;
          currentMapRef.current.addControl(overlay);
          setDeckOverlay(overlay);
      } else {
          currentOverlayRef.current.setProps({ layers });
      }
  }, [mergedFeatures, cdPerimeters, projectCDsSet, handleLayerClick, updateTooltip]);

  // 7. Navigation Handler
  useEffect(() => {
    const handleNavigation = (cdName: string) => {
        if (!currentMapRef.current || !geojsonData) return;
        
        const normSearch = String(cdName).trim();
        const feature = geojsonData.features.find((f: any) => {
            const code = f.properties?.cdCode || f.properties?.boro_cd;
            return String(code).trim() === normSearch;
        });

        if (feature) {
            const bbox = calculateBoundingBox(feature) as BoundingBox;
            currentMapRef.current.flyTo({
                center: [(bbox.minLng + bbox.maxLng) / 2, (bbox.minLat + bbox.maxLat) / 2],
                zoom: 13.5,
                pitch: 50,
                bearing: -10,
                duration: 2000,
                essential: true
            });
        }
    };

    window.mapFunctions = window.mapFunctions || {};
    // @ts-ignore
    window.mapFunctions[mapId] = {}; 

    mapEventManager.registerNavigationHandler(mapId, handleNavigation);
    
    const handleEvent = (e: any) => {
        if (e.detail?.mapId === mapId) handleNavigation(e.detail.cdCode);
    };
    window.addEventListener('navigateToCD', handleEvent);

    return () => {
        mapEventManager.unregisterNavigationHandler(mapId);
        window.removeEventListener('navigateToCD', handleEvent);
    };
  }, [mapId, geojsonData]);

  return null;
});
