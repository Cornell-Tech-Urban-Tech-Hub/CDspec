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
            transition: opacity 0.2s ease-out;
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

  const isMounted = useRef(true);
  const currentMapRef = useRef<any>(null);
  const currentOverlayRef = useRef<any>(null);
  const markerRef = useRef<any>(null); 
  const markerElRef = useRef<HTMLDivElement | null>(null);
  const lastHoveredCDRef = useRef<string | null>(null);
  const animationRef = useRef<number | null>(null);
  const targetPosRef = useRef<[number, number] | null>(null);
  const currentPosRef = useRef<[number, number] | null>(null);
  
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
          antialias: true
      } as any);

      currentMapRef.current = map;
      if (mapId === 'default-map') setMapInstance(map);
      mapCleanupManager.registerMap(mapId, map);

      map.addControl(new maplibregl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
        showZoom: true
      }), 'top-right');

      // Initialize Persistent Marker
      const el = document.createElement('div');
      el.className = 'map-billboard-marker';
      el.style.pointerEvents = 'none';
      el.style.willChange = 'transform, opacity';
      el.style.opacity = '0'; // Start hidden
      el.style.paddingBottom = '20px'; // Persistent style
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
      
      map.on('move', () => {
         if (onZoomChange) onZoomChange(map.getZoom());
      });

      return () => {
        isCancelled = true;
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
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

  // 5. Imperative Hover Handler
  const updateTooltip = useCallback((info: any) => {
    const map = currentMapRef.current;
    if (!map) return;

    const hoveredObject = info.object;
    const el = markerElRef.current;
    const marker = markerRef.current;

    if (!el || !marker) return;

    // --- Tooltip/Billboard Update ---
    if (!hoveredObject) {
        if (lastHoveredCDRef.current !== null) {
            // Just hide it, don't destroy it
            el.style.opacity = '0';
            lastHoveredCDRef.current = null;
            targetPosRef.current = null;
        }
        return;
    }

    const cdCode = hoveredObject.properties?.cdCode;
    
    // If same CD, skip updates entirely
    if (lastHoveredCDRef.current === cdCode) return;
    
    lastHoveredCDRef.current = cdCode;
    const hasProject = hoveredObject.properties?.isActive; // Use pre-calculated prop

    let targetPos: [number, number] | null = null;
    // 1. Try pre-calculated centroid
    if (hoveredObject.properties?.centroid) {
        targetPos = hoveredObject.properties.centroid;
    } 
    // 2. Use event coordinate if available (instant)
    else if (info.coordinate) {
        targetPos = [info.coordinate[0], info.coordinate[1]];
    }
    
    if (!targetPos) return;

    // Show marker (if it was hidden)
    el.style.opacity = '1';

    // Efficient DOM Update
    el.innerHTML = `
      <div class="bg-white/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-lg border ${hasProject ? 'border-emerald-500' : 'border-gray-200'} transform transition-all duration-200">
        <h3 class="text-sm font-bold text-gray-900 mb-0.5">${cdCode || 'District'}</h3>
        ${hasProject 
          ? '<span class="text-xs font-medium text-emerald-600 flex items-center gap-1">● Active Project</span>' 
          : '<span class="text-xs text-gray-500">No active project</span>'}
      </div>
      <div class="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] ${hasProject ? 'border-t-emerald-500' : 'border-t-white'} mx-auto mt-[-1px]"></div>
    `;

    // Initialize or Update Marker Position
    targetPosRef.current = targetPos;
    
    // If this is the first show after being hidden, snap to position immediately
    if (!currentPosRef.current) {
        currentPosRef.current = targetPos;
        marker.setLngLat(targetPos);
    }

    // C. Glide Animation Loop
    // Optimization: Increased speed factor from 0.25 to 0.6 for snappier feel
    if (!animationRef.current) {
        const animate = () => {
            if (!targetPosRef.current || !currentPosRef.current) {
                animationRef.current = null;
                return;
            }
            
            // FASTER INTERPOLATION (0.6 instead of 0.25)
            const speed = 0.6;
            const lng = currentPosRef.current[0] + (targetPosRef.current[0] - currentPosRef.current[0]) * speed;
            const lat = currentPosRef.current[1] + (targetPosRef.current[1] - currentPosRef.current[1]) * speed;
            
            currentPosRef.current = [lng, lat];
            marker.setLngLat(currentPosRef.current);

            const distSq = Math.pow(targetPosRef.current[0] - lng, 2) + Math.pow(targetPosRef.current[1] - lat, 2);
            if (distSq > 0.000000001) {
                animationRef.current = requestAnimationFrame(animate);
            } else {
                marker.setLngLat(targetPosRef.current);
                currentPosRef.current = targetPosRef.current;
                animationRef.current = null; 
            }
        };
        animationRef.current = requestAnimationFrame(animate);
    }

  }, [projectCDsSet]);

  // 6. Base Layers Update
  useEffect(() => {
      if (!currentMapRef.current || !geojsonData) return;
      
      const layerPrefix = `${mapId}-layers`;
      const commonProps = {
        pickable: true,
        stroked: true,
        filled: true,
        extruded: true,
        wireframe: true,
        lineWidthScale: 1,
        lineWidthMinPixels: 1,
        // Data-driven styling instead of separate layers
        getFillColor: ((d: any) => d.properties.isActive ? [16, 185, 129, 20] : [0,0,0,0]) as any,
        getLineColor: ((d: any) => d.properties.isActive ? [16, 185, 129, 200] : [156, 163, 175, 100]) as any,
        getElevation: ((d: any) => d.properties.isActive ? 100 : 0) as any,
        autoHighlight: true, // GPU Highlight
        highlightColor: [16, 185, 129, 50],
        parameters: { depthTest: true },
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
          }));
      }

      // Outlines (Not pickable)
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
              parameters: { depthTest: false, zIndex: 10 },
              updateTriggers: {
                  getLineColor: [projectCDs],
                  getLineWidth: [projectCDs]
              }
          }));
      }

      // Update ref so tooltip handler can access base layers
      baseLayersRef.current = layers;

      // Initial overlay setup or update
      if (!currentOverlayRef.current) {
          const overlay = new MapboxOverlay({ 
              interleaved: true, 
              layers 
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
