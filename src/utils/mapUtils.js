import * as turf from '@turf/turf';

/**
 * Creates perimeter features from CD polygons without buffering
 * @param {object} geojsonData - The GeoJSON data containing CD features
 * @returns {Array} Array of perimeter features
 */
export function createCdPerimeters(geojsonData) {
  if (!geojsonData || !Array.isArray(geojsonData.features)) {
    console.error("Invalid GeoJSON data structure");
    return [];
  }
  
  const cdFeatureGroups = {};
  
  geojsonData.features.forEach(feature => {
    if (!feature || !feature.properties) return;
    
    const cdCode = feature.properties.boro_cd;
    if (!cdCode) return;
    
    if (!cdFeatureGroups[cdCode]) {
      cdFeatureGroups[cdCode] = [];
    }
    cdFeatureGroups[cdCode].push(feature);
  });
  
  const perimeters = [];
  
  Object.entries(cdFeatureGroups).forEach(([cdCode, features]) => {
    try {
      if (!features || features.length === 0) return;
      
      // Just union the raw features directly without buffering
      // This is significantly faster and cleaner
      let combined = features[0];
      for (let i = 1; i < features.length; i++) {
        try {
          combined = turf.union(combined, features[i]);
        } catch (err) {
          console.warn(`Error unioning features for CD ${cdCode}:`, err);
        }
      }
      
      if (!combined || !combined.geometry) return;
      
      let perimeterFeature;
      
      try {
        if (combined.geometry.type === 'Polygon') {
          const outerRing = combined.geometry.coordinates[0];
          if (!Array.isArray(outerRing)) return;
          perimeterFeature = turf.lineString(outerRing);
        } else if (combined.geometry.type === 'MultiPolygon') {
          const validPolys = combined.geometry.coordinates.filter(
            poly => Array.isArray(poly) && poly.length > 0 && Array.isArray(poly[0])
          );
          if (validPolys.length === 0) return;
          
          const lines = validPolys.map(poly => {
            return turf.lineString(poly[0]);
          });
          perimeterFeature = turf.multiLineString(lines.map(l => l.geometry.coordinates));
        } else {
          return;
        }
        
        perimeterFeature.properties = { cdCode };
        perimeters.push(perimeterFeature);
      } catch (error) {
        console.error(`Error creating perimeter for CD ${cdCode}:`, error);
      }
    } catch (error) {
      console.error(`Error processing perimeter for CD ${cdCode}:`, error);
    }
  });
  
  return perimeters;
}

/**
 * Creates polygon features from CD geometries
 * @param {object} geojsonData - The GeoJSON data containing CD features
 * @returns {Array} Array of polygon features
 */
export function createCdPolygons(geojsonData) {
  if (!geojsonData || !Array.isArray(geojsonData.features)) {
    return [];
  }
  
  const cdFeatureGroups = {};
  
  geojsonData.features.forEach(feature => {
    const cdCode = feature.properties?.boro_cd;
    if (!cdCode) return;
    
    if (!cdFeatureGroups[cdCode]) {
      cdFeatureGroups[cdCode] = [];
    }
    cdFeatureGroups[cdCode].push(feature);
  });
  
  const polygons = [];
  
  Object.entries(cdFeatureGroups).forEach(([cdCode, features]) => {
    try {
      let combined = features[0];
      for (let i = 1; i < features.length; i++) {
        combined = turf.union(combined, features[i]);
      }
      
      combined.properties = { cdCode };
      polygons.push(combined);
    } catch (error) {
      console.error(`Error processing polygon for CD ${cdCode}:`, error);
    }
  });
  
  return polygons;
}

/**
 * Calculates the bounding box of a feature
 * @param {object} feature - A GeoJSON feature
 * @returns {object} The bounding box coordinates
 */
export function calculateBoundingBox(feature) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  
  const processCoordinates = coords => {
    if (Array.isArray(coords[0]) && typeof coords[0][0] !== 'number') {
      coords.forEach(processCoordinates);
    } else if (Array.isArray(coords[0])) {
      coords.forEach(point => {
        minLng = Math.min(minLng, point[0]);
        maxLng = Math.max(maxLng, point[0]);
        minLat = Math.min(minLat, point[1]);
        maxLat = Math.max(maxLat, point[1]);
      });
    }
  };
  
  processCoordinates(feature.geometry.coordinates);
  
  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Gets the URL base path safely
 * @returns {string} The base URL with trailing slash removed
 */
export function getBasePath() {
  let base = '';
  try {
    base = import.meta.env.BASE_URL || '/';
    base = base.endsWith('/') ? base.slice(0, -1) : base;
  } catch (e) {
    console.warn('Error accessing BASE_URL:', e);
    base = '';
  }
  return base;
}

/**
 * Safely navigates to a CD project page
 * @param {string} cdCode - Code of the CD
 * @param {object} cdToSlugMap - Map of CD codes to project slugs
 * @returns {boolean} Success status of navigation attempt
 */
export function navigateToCdProject(cdCode, cdToSlugMap) {
  try {
    if (!cdCode || !cdToSlugMap || !cdToSlugMap[cdCode]) {
      console.warn(`Cannot navigate to CD project: missing slug for ${cdCode}`);
      return false;
    }
    
    const projectSlug = cdToSlugMap[cdCode];
    const baseUrl = getBasePath();
         window.location.href = `${baseUrl}/projects/${projectSlug}`;
    return true;
  } catch (error) {
    console.error(`Error navigating to CD project ${cdCode}:`, error);
    return false;
  }
}
