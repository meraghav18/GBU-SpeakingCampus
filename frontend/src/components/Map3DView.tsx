import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Box,
  ExternalLink,
  Layers,
  LocateFixed,
  Maximize2,
  Navigation,
  Search,
  Volume2,
  X,
} from 'lucide-react';
import { Landmark, MapStyleMode, Place, RouteData } from '../types/navigation';
import { MAPTILER_KEY } from '../services/api';
import { speakAnnouncement } from '../hooks/useLiveNavigation';
import { CATEGORY_META, metaFor } from '../data/categories';

type Map3DViewProps = {
  destination: Place;
  places: Place[];
  landmarks: Landmark[];
  route: RouteData | null;
  startPoint: [number, number] | null; // [lat, lon]
  liveGps: [number, number] | null; // [lat, lon]
  headingDeg: number | null;
  followUser: boolean;
  onToggleFollow: () => void;
  pickPinMode?: boolean;
  onSelectStartPin?: (coords: [number, number]) => void;
  onSelectNewDestination?: (place: Place) => void;
  speakerMode?: 'auto' | 'off';
  lang: 'en' | 'hi';
};

type InspectedSpot = {
  title: string;
  category: string;
  categoryKey: string;
  description: string;
  lat: number;
  lon: number;
  placeObj?: Place;
};

// GBU campus outline (Wikimapia object 10253917), [lon, lat]
const CAMPUS_BOUNDARY: [number, number][] = [
  [77.515553, 28.41919], [77.531169, 28.433155], [77.533726, 28.428439],
  [77.530198, 28.41648], [77.519043, 28.412165], [77.517133, 28.416022],
  [77.51716, 28.416032], [77.51731, 28.416362], [77.517179, 28.416638],
  [77.516801, 28.41676], [77.516761, 28.416746], [77.515553, 28.41919],
];

const LABEL_MIN_ZOOM = 16.2;

function buildMapStyle(mode: MapStyleMode): maplibregl.StyleSpecification | string {
  if (MAPTILER_KEY) {
    if (mode === 'satellite') {
      return `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`;
    }
    return `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;
  }

  if (mode === 'satellite') {
    return {
      version: 8,
      sources: {
        esriSatellite: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'esri-satellite-layer', type: 'raster', source: 'esriSatellite' }],
    };
  }

  return 'https://tiles.openfreemap.org/styles/liberty';
}

function buildOsmFallbackStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm-base', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }],
  };
}

function registerArrowIcon(map: maplibregl.Map) {
  if (map.hasImage('route-direction-arrow')) return;
  const size = 36;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.beginPath();
  ctx.moveTo(12, 9);
  ctx.lineTo(24, 18);
  ctx.lineTo(12, 27);
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  map.addImage('route-direction-arrow', ctx.getImageData(0, 0, size, size));
}

export default function Map3DView({
  destination,
  places,
  route,
  startPoint,
  liveGps,
  headingDeg,
  followUser,
  onToggleFollow,
  pickPinMode = false,
  onSelectStartPin,
  onSelectNewDestination,
  speakerMode = 'auto',
  lang,
}: Map3DViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const placeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const appliedStyleRef = useRef<MapStyleMode>('street');
  const syncRef = useRef<() => void>(() => {});

  const [styleMode, setStyleMode] = useState<MapStyleMode>('street');
  const [is3D, setIs3D] = useState<boolean>(false);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [mapReady, setMapReady] = useState<boolean>(false);
  const [inspectedSpot, setInspectedSpot] = useState<InspectedSpot | null>(null);
  const [mapFallbackNotice, setMapFallbackNotice] = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const nameOf = (p: Place) => (lang === 'hi' && p.name_hi ? p.name_hi : p.name);

  const presentCategories = useMemo(
    () => Object.keys(CATEGORY_META).filter((c) => places.some((p) => p.category === c)),
    [places]
  );

  const searchResults = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return [];
    return places
      .filter((p) =>
        [p.name, p.name_hi || '', p.category, ...(p.aliases || [])]
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 8);
  }, [places, searchText]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(styleMode),
      center: [destination.longitude, destination.latitude],
      zoom: 16.4,
      pitch: 0,
      bearing: 0,
      maxPitch: 70,
      antialias: true,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      registerArrowIcon(map);
      applyMapEnhancements(map);
      setMapReady(true);
    });

    map.on('zoom', () => setShowLabels(map.getZoom() >= LABEL_MIN_ZOOM));
    map.on('pitchend', () => setIs3D(map.getPitch() > 10));

    map.on('error', (e) => {
      const errMsg = e?.error?.message || '';
      if (
        appliedStyleRef.current !== 'satellite' &&
        (errMsg.includes('openfreemap') || errMsg.includes('style') || !map.isStyleLoaded())
      ) {
        try {
          map.setStyle(buildOsmFallbackStyle());
          setMapFallbackNotice(
            lang === 'hi' ? 'OpenStreetMap लाइव मैप सक्रिय है।' : 'OpenStreetMap live map active.'
          );
        } catch {
          // ignore
        }
      }
    });

    mapRef.current = map;

    return () => {
      placeMarkersRef.current.forEach((m) => m.remove());
      placeMarkersRef.current = [];
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const canvas = map.getCanvas();
    canvas.style.cursor = pickPinMode ? 'crosshair' : '';

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      setSearchOpen(false);
      const clickedLat = Number(e.lngLat.lat.toFixed(6));
      const clickedLon = Number(e.lngLat.lng.toFixed(6));

      const features = map.queryRenderedFeatures(e.point);
      const namedFeature = features.find(
        (f) => f.properties && (f.properties.name || f.properties['name:en'])
      );

      if (namedFeature && namedFeature.properties) {
        const fName = String(namedFeature.properties['name:en'] || namedFeature.properties.name);
        const matchedPlace = places.find(
          (p) =>
            p.name.toLowerCase().includes(fName.toLowerCase()) ||
            fName.toLowerCase().includes(p.name.toLowerCase())
        );

        if (matchedPlace) {
          inspectPlace(matchedPlace);
        } else {
          const spot: InspectedSpot = {
            title: fName,
            category: lang === 'hi' ? 'कैंपस स्थान' : 'Campus location',
            categoryKey: '',
            description:
              lang === 'hi'
                ? `${fName} — गौतम बुद्ध विश्वविद्यालय परिसर के अंदर स्थित स्थान।`
                : `${fName} — location inside Gautam Buddha University campus.`,
            lat: clickedLat,
            lon: clickedLon,
          };
          setInspectedSpot(spot);
          if (speakerMode === 'auto') speakAnnouncement(`${spot.title}. ${spot.description}`, lang);
        }
      }

      if (pickPinMode && onSelectStartPin) onSelectStartPin([clickedLat, clickedLon]);
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
      canvas.style.cursor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickPinMode, onSelectStartPin, places, lang, speakerMode]);

  function inspectPlace(place: Place, fly = false) {
    const title = nameOf(place);
    const meta = metaFor(place.category);
    const category = lang === 'hi' ? place.category_hi || meta.hi : place.category;
    const description =
      lang === 'hi' && place.description_hi ? place.description_hi : place.description;

    setInspectedSpot({
      title,
      category,
      categoryKey: place.category,
      description,
      lat: place.latitude,
      lon: place.longitude,
      placeObj: place,
    });

    if (fly) {
      mapRef.current?.flyTo({
        center: [place.longitude, place.latitude],
        zoom: Math.max(17.4, mapRef.current.getZoom()),
        duration: 700,
      });
    }

    if (speakerMode === 'auto') speakAnnouncement(`${title}. ${description}`, lang);
  }

  function applyMapEnhancements(map: maplibregl.Map) {
    try {
      const style = map.getStyle();
      if (!style || !style.sources) return;
      if (style.layers?.some((l) => l.id === 'gbu-3d-buildings')) return;

      const vectorSourceKey = Object.keys(style.sources).find(
        (k) => style.sources[k]?.type === 'vector'
      );
      if (!vectorSourceKey) return;

      const labelLayerId = style.layers?.find(
        (l) => l.type === 'symbol' && l.layout && 'text-field' in l.layout
      )?.id;

      // Google-style soft grey buildings; extrude only gains height when tilted.
      map.addLayer(
        {
          id: 'gbu-3d-buildings',
          source: vectorSourceKey,
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14.5,
          paint: {
            'fill-extrusion-color': '#e8e6e1',
            'fill-extrusion-height': [
              'coalesce', ['get', 'render_height'], ['get', 'height'], 9,
            ],
            'fill-extrusion-base': [
              'coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0,
            ],
            'fill-extrusion-opacity': 0.9,
          },
        },
        labelLayerId
      );
    } catch {
      // keep base map
    }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyleRef.current === styleMode) return;
    appliedStyleRef.current = styleMode;
    setMapReady(false);
    map.setStyle(buildMapStyle(styleMode));
    map.once('styledata', () => {
      registerArrowIcon(map);
      applyMapEnhancements(map);
      setMapReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleMode]);

  function upsertGeoJson(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
    const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
      return false;
    }
    map.addSource(id, { type: 'geojson', data });
    return true;
  }

  function syncRouteAndMarkers() {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once('idle', () => syncRef.current());
      return;
    }
    registerArrowIcon(map);

    // Campus boundary
    const boundaryAdded = upsertGeoJson(map, 'gbu-campus-boundary', {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [CAMPUS_BOUNDARY] } },
      ],
    });
    if (boundaryAdded) {
      map.addLayer({
        id: 'gbu-campus-fill',
        type: 'fill',
        source: 'gbu-campus-boundary',
        paint: { 'fill-color': '#34a853', 'fill-opacity': styleMode === 'satellite' ? 0 : 0.05 },
      });
      map.addLayer({
        id: 'gbu-campus-line',
        type: 'line',
        source: 'gbu-campus-boundary',
        paint: { 'line-color': styleMode === 'satellite' ? '#ffffff' : '#1e8e3e', 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
      });
    }

    // Route (Google Maps walking blue)
    const routeAdded = upsertGeoJson(map, 'gbu-route-source', {
      type: 'FeatureCollection',
      features:
        route && route.coordinates.length >= 2
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coordinates } }]
          : [],
    });
    if (routeAdded) {
      map.addLayer({
        id: 'gbu-route-casing',
        type: 'line',
        source: 'gbu-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#1967d2', 'line-width': 10 },
      });
      map.addLayer({
        id: 'gbu-route-line',
        type: 'line',
        source: 'gbu-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#4285f4', 'line-width': 7 },
      });
      map.addLayer({
        id: 'gbu-route-arrows',
        type: 'symbol',
        source: 'gbu-route-source',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 60,
          'icon-image': 'route-direction-arrow',
          'icon-size': 0.55,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }

    placeMarkersRef.current.forEach((m) => m.remove());
    placeMarkersRef.current = [];

    places.forEach((place) => {
      const isDest = place.id === destination.id;
      if (!isDest && activeCategory && place.category !== activeCategory) return;

      const meta = metaFor(place.category);
      const el = document.createElement('div');
      el.className = isDest ? 'gm-marker gm-marker-dest' : 'gm-marker';
      el.style.setProperty('--pin', isDest ? '#ea4335' : meta.color);
      el.title = nameOf(place);

      const pin = document.createElement('div');
      pin.className = 'gm-pin';
      const glyph = document.createElement('span');
      glyph.textContent = meta.glyph;
      pin.appendChild(glyph);
      const label = document.createElement('div');
      label.className = 'gm-label';
      label.textContent = nameOf(place);
      el.append(pin, label);

      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        inspectPlace(place);
      });

      placeMarkersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([place.longitude, place.latitude])
          .addTo(map)
      );
    });

    if (startPoint) {
      const startEl = document.createElement('div');
      startEl.className = 'gm-start-dot';
      placeMarkersRef.current.push(
        new maplibregl.Marker({ element: startEl }).setLngLat([startPoint[1], startPoint[0]]).addTo(map)
      );
    }
  }

  syncRef.current = syncRouteAndMarkers;

  useEffect(() => {
    if (!mapReady) return;
    syncRouteAndMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, route, destination, places, startPoint, lang, speakerMode, activeCategory]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (followUser && liveGps) {
      map.easeTo({
        center: [liveGps[1], liveGps[0]],
        bearing: headingDeg !== null && Number.isFinite(headingDeg) ? headingDeg : map.getBearing(),
        pitch: Math.max(50, map.getPitch()),
        zoom: Math.max(17.5, map.getZoom()),
        duration: 600,
      });
      return;
    }

    if (route && route.coordinates.length >= 2) {
      const bounds = new maplibregl.LngLatBounds();
      route.coordinates.forEach((c) => {
        if (c.length >= 2) bounds.extend([c[0], c[1]]);
      });
      map.fitBounds(bounds, {
        padding: { top: 120, bottom: 120, left: 60, right: 60 },
        maxZoom: 18,
        duration: 850,
      });
    } else {
      map.flyTo({ center: [destination.longitude, destination.latitude], zoom: 16.8, duration: 750 });
    }
  }, [route, destination, mapReady, followUser, liveGps, headingDeg]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!liveGps) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }

    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'ml-gps-user';
      el.innerHTML = '<div class="ml-gps-arrow"></div><div class="ml-gps-dot"></div>';
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([liveGps[1], liveGps[0]])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([liveGps[1], liveGps[0]]);
    }

    const arrowEl = userMarkerRef.current
      .getElement()
      .querySelector('.ml-gps-arrow') as HTMLElement | null;
    if (arrowEl) {
      if (headingDeg !== null && Number.isFinite(headingDeg)) {
        arrowEl.style.opacity = '1';
        arrowEl.style.transform = `translate(-50%, -100%) rotate(${headingDeg}deg)`;
      } else {
        arrowEl.style.opacity = '0';
      }
    }
  }, [liveGps, headingDeg]);

  function toggle3D() {
    const map = mapRef.current;
    if (!map) return;
    const next = !is3D;
    setIs3D(next);
    map.easeTo({ pitch: next ? 60 : 0, bearing: next ? -20 : 0, duration: 500 });
  }

  function fitCampus() {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new maplibregl.LngLatBounds();
    CAMPUS_BOUNDARY.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: 50, duration: 700 });
  }

  const inspectedMeta = inspectedSpot ? metaFor(inspectedSpot.categoryKey) : null;

  return (
    <div className={showLabels ? 'map3d-shell' : 'map3d-shell gm-labels-off'}>
      {/* Google-style search + category chips */}
      <div className="gm-topbar">
        <div className="gm-search">
          <Search size={18} />
          <input
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchResults[0]) {
                inspectPlace(searchResults[0], true);
                setSearchOpen(false);
              }
            }}
            placeholder={lang === 'hi' ? 'GBU में खोजें' : 'Search GBU campus'}
            aria-label={lang === 'hi' ? 'GBU में खोजें' : 'Search GBU campus'}
          />
          {searchText && (
            <button type="button" onClick={() => setSearchText('')} aria-label="Clear search">
              <X size={16} />
            </button>
          )}
          {searchOpen && searchResults.length > 0 && (
            <ul className="gm-search-results">
              {searchResults.map((p) => {
                const meta = metaFor(p.category);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        inspectPlace(p, true);
                        setSearchOpen(false);
                      }}
                    >
                      <span className="gm-result-dot" style={{ background: meta.color }}>
                        {meta.glyph}
                      </span>
                      <span>
                        <b>{nameOf(p)}</b>
                        <small>{lang === 'hi' ? p.category_hi || meta.hi : p.category}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="gm-chips">
          {presentCategories.map((cat) => {
            const meta = metaFor(cat);
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                className={active ? 'gm-chip active' : 'gm-chip'}
                style={active ? { background: meta.color, borderColor: meta.color } : undefined}
                onClick={() => setActiveCategory(active ? null : cat)}
              >
                <span>{meta.glyph}</span>
                {lang === 'hi' ? meta.hi : meta.en}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right-side floating controls */}
      <div className="gm-fab-stack">
        <button type="button" className={is3D ? 'active' : ''} onClick={toggle3D} title="3D">
          <Box size={18} />
          <small>3D</small>
        </button>
        <button type="button" onClick={fitCampus} title={lang === 'hi' ? 'पूरा कैंपस' : 'Whole campus'}>
          <Maximize2 size={18} />
        </button>
        <button
          type="button"
          className={followUser ? 'active' : ''}
          onClick={onToggleFollow}
          title={lang === 'hi' ? 'मेरी लोकेशन' : 'My location'}
        >
          <LocateFixed size={18} />
        </button>
      </div>

      {/* Bottom-left layer tile */}
      <button
        type="button"
        className={`gm-layer-tile ${styleMode === 'satellite' ? 'to-map' : 'to-sat'}`}
        onClick={() => setStyleMode(styleMode === 'satellite' ? 'street' : 'satellite')}
      >
        <Layers size={14} />
        <span>
          {styleMode === 'satellite'
            ? lang === 'hi' ? 'मैप' : 'Map'
            : lang === 'hi' ? 'सैटेलाइट' : 'Satellite'}
        </span>
      </button>

      {/* Google-style place card */}
      {inspectedSpot && (
        <div className="gm-place-card">
          <div className="gm-place-head">
            <div>
              <b>{inspectedSpot.title}</b>
              <small style={{ color: inspectedMeta?.color }}>
                {inspectedMeta?.glyph}&nbsp; {inspectedSpot.category}
              </small>
            </div>
            <button type="button" onClick={() => setInspectedSpot(null)} aria-label="Close detail card">
              <X size={18} />
            </button>
          </div>
          <p>{inspectedSpot.description}</p>
          <div className="gm-place-actions">
            {inspectedSpot.placeObj &&
              inspectedSpot.placeObj.id !== destination.id &&
              onSelectNewDestination && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    onSelectNewDestination(inspectedSpot.placeObj!);
                    setInspectedSpot(null);
                  }}
                >
                  <Navigation size={14} />
                  {lang === 'hi' ? 'दिशा-निर्देश' : 'Directions'}
                </button>
              )}
            <button
              type="button"
              onClick={() => speakAnnouncement(`${inspectedSpot.title}. ${inspectedSpot.description}`, lang)}
            >
              <Volume2 size={14} />
              {lang === 'hi' ? 'सुनें' : 'Listen'}
            </button>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${inspectedSpot.lat},${inspectedSpot.lon}&travelmode=walking`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} />
              Google Maps
            </a>
          </div>
        </div>
      )}

      {mapFallbackNotice && <div className="map3d-notice">{mapFallbackNotice}</div>}

      {pickPinMode && !route && (
        <div className="map3d-pick-banner">
          {lang === 'hi'
            ? '📍 शुरुआती बिंदु चुनने के लिए मैप पर क्लिक करें'
            : '📍 Click the map to drop your start point'}
        </div>
      )}
      <div ref={containerRef} className="map3d-canvas" />
    </div>
  );
}
