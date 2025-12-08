import * as React from 'react';
const { useState, useEffect, useRef, useMemo, useCallback } = React;
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapProvider, useMapContext } from './MapContext';
import mapCleanupManager from '../../utils/mapCleanup';
import { calculateBoundingBox } from '../../utils/mapUtils';
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
            transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                        transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            transform-origin: bottom center;
          }
          .map-billboard-marker[style*="opacity: 0"] {
            transform: scale(0.9) translateY(4px);
          }
          .map-billboard-marker[style*="opacity: 1"] {
            transform: scale(1) translateY(0);
          }
          .tooltip-content {
            background: rgba(255, 255, 255, 0.97);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            padding: 10px 14px;
            border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
                        0 2px 8px rgba(0, 0, 0, 0.08);
            border: 1px solid rgba(229, 231, 235, 0.8);
            animation: tooltipFadeIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          }
          @keyframes tooltipFadeIn {
            from {
              opacity: 0.5;
              transform: scale(0.96);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
          .tooltip-content.active {
            border-color: rgba(16, 185, 129, 0.6);
            box-shadow: 0 8px 32px rgba(16, 185, 129, 0.15),
                        0 2px 8px rgba(0, 0, 0, 0.08);
          }
          .tooltip-content h3 {
            font-size: 14px;
            font-weight: 700;
            color: #111827;
            margin: 0 0 4px 0;
            line-height: 1.2;
          }
          .tooltip-content span {
            font-size: 12px;
            color: #6b7280;
            display: flex;
            align-items: center;
            gap: 4px;
          }
          .tooltip-content.active span {
            color: #10b981;
            font-weight: 500;
          }
          .tooltip-arrow {
            width: 0;
            height: 0;
            border-left: 8px solid transparent;
            border-right: 8px solid transparent;
            border-top: 10px solid rgba(255, 255, 255, 0.97);
            margin: -1px auto 0 auto;
            filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.06));
          }
          .tooltip-arrow.active {
            border-top-color: rgba(16, 185, 129, 0.9);
          }
          .maplibregl-canvas {
            outline: none !important;
            image-rendering: -webkit-optimize-contrast;
            image-rendering: crisp-edges;
          }
          /* Prevent flickering during animations */
          .maplibregl-map {
            -webkit-transform: translateZ(0);
            transform: translateZ(0);
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
  const [styleReady, setStyleReady] = useState(false);
  
  // Track if map is moving to disable transitions during zoom/pan
  const isMovingRef = useRef<boolean>(false);
  
  // Store layers in ref to access them in callbacks without triggering renders
  const baseLayersRef = useRef<any[]>([]);
  
  // Memoize project CDs set for fast lookups
  const projectCDsSet = useMemo(() => {
    return new Set(projectCDs.map(cd => String(cd).trim()));
  }, [projectCDs]);

  // MERGED FEATURES (Optimize Picking Performance)
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
      setStyleReady(false);
      const mapContainer = document.getElementById(mapContainerId);
      if (!mapContainer || currentMapRef.current) return;

      if (!geojsonData) {
         try {
            // Use original geometry for clean perimeter rendering
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

      const arcgisService =
        'https://tiles.arcgis.com/tiles/yG5s3afENB5iO9fj/arcgis/rest/services/NYC_Basemap_v3/VectorTileServer';
      const arcgisStyleUrl = `${arcgisService}/resources/styles/root.json`;
      const useArcGIS = true; // lock to ArcGIS basemap (Carto disabled)

      const loadArcgisStyle = async () => {
        const res = await fetch(arcgisStyleUrl, { mode: 'cors' });
        if (!res.ok) {
          throw new Error(`ArcGIS style fetch failed: ${res.status}`);
        }
        const style = await res.json();

        const styleBase = new URL('./', arcgisStyleUrl).toString();

        // Normalize sprite/glyph paths to absolute URLs
        // Normalize sprite/glyphs to absolute URLs, preserving MapLibre tokens
        style.sprite = `${arcgisService}/resources/sprites/sprite`;
        style.glyphs = `${arcgisService}/resources/fonts/{fontstack}/{range}.pbf`;

        // Normalize vector tiles/urls to absolute URLs
        if (style.sources) {
          Object.values(style.sources).forEach((source: any) => {
            if (source?.type === 'vector') {
              // Force tiles to the VectorTileServer endpoint and drop url to avoid non-TileJSON fetch
              source.tiles = [`${arcgisService}/tile/{z}/{y}/{x}.pbf`];
              if (source.url) delete source.url;
            }
          });
        }
        return style;
      };

      let normalizedStyle: any = null;
      if (useArcGIS) {
        try {
          normalizedStyle = await loadArcgisStyle();
        } catch (err) {
          console.error('ArcGIS style load failed; map not initialized', err);
          return;
        }
      }

      console.info('ArcGIS style (normalized) sprite:', normalizedStyle?.sprite, 'glyphs:', normalizedStyle?.glyphs);

      const map = new maplibregl.Map({
          container: mapLibreId,
          // NYC Human Geography basemap (ArcGIS) — Carto disabled
          style: normalizedStyle,
          center: [-74.0060, 40.63],
          zoom: initialZoom,
          pitch: 45,
          bearing: -15,
          minZoom: 10,
          maxZoom: 16,
          antialias: true, // Smooth edges on 3D extrusions
          fadeDuration: 100, // Smooth tile transitions during zoom
          trackResize: true,
          renderWorldCopies: false,
          preserveDrawingBuffer: false,
          pixelRatio: window.devicePixelRatio, // Use native pixel ratio for sharp rendering
          validate: false, // allow relative sprite/glyph paths in style
      } as any);
      (window as any).__lastMap = map;

      const updateStyleReady = () => {
        if (!isCancelled && map.isStyleLoaded()) setStyleReady(true);
      };
      map.on('styledata', updateStyleReady);

      // Restrict place labels to NYC (hide NJ/LI) only when using Carto basemap
      if (!useArcGIS) {
        const clampPlaceLabelsToNYC = () => {
          const style = map.getStyle();
          if (!style?.layers) return;

          const boroughWhitelist = ['Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Bronx', 'Staten Island', 'New York'];
          const nycCondition: any = [
            'any',
            ['==', ['get', 'state_code'], 'NY'],
            ['==', ['get', 'region_code'], 'NY'],
            ['==', ['get', 'state'], 'New York'],
            ['==', ['get', 'iso_3166_2'], 'US-NY'],
            ['in', ['get', 'name'], ['literal', boroughWhitelist]],
          ];

          style.layers.forEach((layer: any) => {
            // Carto Positron place label layers include "place" in the id
            if (layer.type === 'symbol' && layer.id.toLowerCase().includes('place')) {
              const existing = map.getFilter(layer.id);
              const nextFilter = existing ? ['all', existing, nycCondition] : nycCondition;
              map.setFilter(layer.id, nextFilter as any);

              // Also force opacity to 0 for anything not matching to cover sources without filters
              map.setPaintProperty(
                layer.id,
                'text-opacity',
                ['case', nycCondition, 1, 0] as any
              );
              map.setPaintProperty(
                layer.id,
                'text-halo-opacity',
                ['case', nycCondition, 1, 0] as any
              );
            }
          });
        };

        // Apply once loaded, and re-apply on any style refresh so labels stay clamped
        if (map.isStyleLoaded()) clampPlaceLabelsToNYC();
        map.on('styledata', clampPlaceLabelsToNYC);
      }

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
          // Outline layer is added via separate effect (6b) for proper reactivity
          if (!isCancelled && onMapLoaded) onMapLoaded();
          if (!isCancelled) setStyleReady(true);
      });
      
      // Track map movement for transition control
      map.on('movestart', () => {
         isMovingRef.current = true;
      });
      
      map.on('moveend', () => {
         isMovingRef.current = false;
         if (onZoomChange) onZoomChange(map.getZoom());
      });

      return () => {
        isCancelled = true;
        setStyleReady(false);
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
        <span>${hasProject 
          ? '<span style="width:6px;height:6px;background:#10b981;border-radius:50%;display:inline-block;animation:pulse 2s infinite"></span> View Project' 
          : 'No active project'}</span>
      </div>
      <div class="tooltip-arrow ${hasProject ? 'active' : ''}"></div>
      <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}</style>
    `;

  }, []);

  // Throttled version for hover events (16ms = ~60fps max)
  const updateTooltip = useMemo(
    () => throttle(updateTooltipCore, 16),
    [updateTooltipCore]
  );

  // 6. Base Layers Update - with smooth hover transitions
  useEffect(() => {
      if (!currentMapRef.current || !geojsonData) return;
      
      const layerPrefix = `${mapId}-layers`;
      
      const layers = [];

      // Deck.gl 3D fills - position beneath basemap labels
      const firstLabelId = currentMapRef.current
        ?.getStyle()
        ?.layers?.find((l: any) => l.type === 'symbol')?.id;

      if (styleReady && mergedFeatures.length > 0) {
          layers.push(new GeoJsonLayer({
              id: `${layerPrefix}-fills`,
              data: mergedFeatures,
              beforeId: firstLabelId || undefined,
              pickable: true,
              stroked: false,
              filled: true,
              extruded: true,
              wireframe: false,
              getFillColor: ((d: any) => 
                d.properties.isActive 
                  ? [255, 143, 41, 140]   // bright orange for active
                  : [140, 140, 140, 70]   // muted gray for inactive
              ) as any,
              getElevation: ((d: any) => d.properties.isActive ? 100 : 0) as any,
              elevationScale: 1,
              autoHighlight: true,
              highlightColor: [255, 143, 41, 200],
              pickingRadius: 3,
              material: {
                ambient: 0.7,
                diffuse: 0.6,
                shininess: 0,
                specularColor: [0, 0, 0]
              },
              parameters: { 
                depthTest: false, // ensure fills draw above basemap geometry
                depthMask: false,
                blend: true,
              },
              onClick: handleLayerClick,
              onHover: updateTooltip,
              updateTriggers: {
                  getFillColor: [projectCDs],
                  getElevation: [projectCDs]
              }
          }));
      }

      baseLayersRef.current = layers;

      // Initial overlay setup or update
      if (!currentOverlayRef.current) {
          const overlay = new MapboxOverlay({ 
              // Interleave so beforeId positions below labels
              interleaved: true,
              layers,
              useDevicePixels: true,
          });
          currentOverlayRef.current = overlay;
          (window as any).__lastOverlay = overlay;
          currentMapRef.current.addControl(overlay);
          setDeckOverlay(overlay);
      } else {
          currentOverlayRef.current.setProps({ layers });
      }
  }, [mergedFeatures, projectCDsSet, handleLayerClick, updateTooltip, styleReady]);

      // 6b. Create/update native MapLibre outline layer (basemap agnostic)
  useEffect(() => {
      const map = currentMapRef.current;
      if (!map || !geojsonData) return;
      
      const addOutlineLayer = () => {
          // Remove existing layer/source if present
          if (map.getLayer('cd-outlines')) {
              map.removeLayer('cd-outlines');
          }
          if (map.getSource('cd-boundaries')) {
              map.removeSource('cd-boundaries');
          }
          
          // Add source
          map.addSource('cd-boundaries', {
              type: 'geojson',
              data: geojsonData
          });
          const firstLabelId = map.getStyle()?.layers?.find((l: any) => l.type === 'symbol')?.id;

          // Add outline layer positioned before first label layer
          const outlineLayer = {
              id: 'cd-outlines',
              type: 'line',
              source: 'cd-boundaries',
              paint: {
              'line-color': [
                  'case',
                  ['in', ['get', 'BoroCD'], ['literal', projectCDs]],
                  '#ff8c00',
                  '#666666'
              ],
                  'line-width': 2,
                  'line-opacity': 1
              }
          };
          if (firstLabelId) {
            map.addLayer(outlineLayer, firstLabelId);
          } else {
            map.addLayer(outlineLayer);
          }
      };
      
      if (!styleReady) return;

      if (map.isStyleLoaded()) {
          addOutlineLayer();
      } else {
          map.once('style.load', addOutlineLayer);
      }
  }, [geojsonData, projectCDs, styleReady]);

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
