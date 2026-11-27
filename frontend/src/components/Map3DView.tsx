import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Compass,
  Eye,
  Layers,
  LocateFixed,
  MapPin,
  Maximize2,
  Mountain,
  Navigation,
  RotateCcw,
  RotateCw,
  Volume2,
  X,
} from 'lucide-react';
import { Landmark, MapStyleMode, Place, RouteData } from '../types/navigation';
import { GOOGLE_MAPS_API_KEY, MAPTILER_KEY } from '../services/api';
import { speakAnnouncement } from '../hooks/useLiveNavigation';

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
  description: string;
  lat: number;
  lon: number;
  placeObj?: Place;
};

function buildMapStyle(mode: MapStyleMode): maplibregl.StyleSpecification | string {
  if (MAPTILER_KEY) {
    if (mode === 'satellite') {
      return `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`;
    }
    if (mode === 'street') {
      return `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;
    }
    return `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`;
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
          attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [
        {
          id: 'esri-satellite-layer',
          type: 'raster',
          source: 'esriSatellite',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
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
    layers: [
      {
        id: 'osm-base',
        type: 'raster',
        source: 'osm',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
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

  ctx.clearRect(0, 0, size, size);
  // Crisp white chevron pointing right (0 deg in MapLibre line symbol)
  ctx.beginPath();
  ctx.moveTo(11, 7);
  ctx.lineTo(26, 18);
  ctx.lineTo(11, 29);
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  const imgData = ctx.getImageData(0, 0, size, size);
  map.addImage('route-direction-arrow', imgData);
}

export default function Map3DView({
  destination,
  places,
  landmarks,
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

  const [styleMode, setStyleMode] = useState<MapStyleMode>('hybrid');
  const [pitch, setPitch] = useState<number>(60);
  const [bearing, setBearing] = useState<number>(0);
  const [mapReady, setMapReady] = useState<boolean>(false);
  const [inspectedSpot, setInspectedSpot] = useState<InspectedSpot | null>(null);
  const [mapFallbackNotice, setMapFallbackNotice] = useState<string>('');

  useEffect(() => {
    if (GOOGLE_MAPS_API_KEY || MAPTILER_KEY) {
      setMapFallbackNotice('');
      return;
    }
    setMapFallbackNotice('');
  }, [lang]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(styleMode),
      center: [destination.longitude, destination.latitude],
      zoom: 16.8,
      pitch: 60,
      bearing: -15,
      antialias: true,
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'top-right'
    );

    map.on('load', () => {
      registerArrowIcon(map);
      setMapReady(true);
      apply3DEnhancements(map);
    });

    map.on('move', () => {
      setPitch(Math.round(map.getPitch()));
      setBearing(Math.round(map.getBearing()));
    });

    map.on('error', (e) => {
      const errMsg = e?.error?.message || '';
      if (
        styleMode !== 'satellite' &&
        (errMsg.includes('openfreemap') ||
          errMsg.includes('style') ||
          !map.isStyleLoaded())
      ) {
        try {
          map.setStyle(buildOsmFallbackStyle());
          setMapFallbackNotice(
            lang === 'hi'
              ? 'OpenStreetMap लाइव मैप सक्रिय है।'
              : 'OpenStreetMap live map active.'
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
      const clickedLat = Number(e.lngLat.lat.toFixed(6));
      const clickedLon = Number(e.lngLat.lng.toFixed(6));

      // Check if user clicked on a named map feature / building
      const features = map.queryRenderedFeatures(e.point);
      const namedFeature = features.find(
        (f) => f.properties && (f.properties.name || f.properties['name:en'])
      );

      if (namedFeature && namedFeature.properties) {
        const fName = String(
          namedFeature.properties['name:en'] || namedFeature.properties.name
        );
        const matchedPlace = places.find((p) =>
          p.name.toLowerCase().includes(fName.toLowerCase()) ||
          fName.toLowerCase().includes(p.name.toLowerCase())
        );

        if (matchedPlace) {
          inspectPlace(matchedPlace);
        } else {
          const spot: InspectedSpot = {
            title: fName,
            category: lang === 'hi' ? 'कैंपस स्थान' : 'CAMPUS LOCATION',
            description:
              lang === 'hi'
                ? `${fName} — गौतम बुद्ध विश्वविद्यालय परिसर के अंदर स्थित स्थान। यहाँ तक रास्ता बनाने के लिए इसे शुरुआती बिंदु या मंज़िल चुन सकते हैं।`
                : `${fName} — Campus building/area inside Gautam Buddha University. You can route from or to this location.`,
            lat: clickedLat,
            lon: clickedLon,
          };
          setInspectedSpot(spot);
          if (speakerMode === 'auto') {
            speakAnnouncement(`${spot.title}. ${spot.description}`, lang);
          }
        }
      }

      if (pickPinMode && onSelectStartPin) {
        onSelectStartPin([clickedLat, clickedLon]);
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
      canvas.style.cursor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickPinMode, onSelectStartPin, places, lang, speakerMode]);

  function inspectPlace(place: Place) {
    const title = lang === 'hi' && place.name_hi ? place.name_hi : place.name;
    const category =
      lang === 'hi' && place.category_hi ? place.category_hi : place.category;
    const description =
      lang === 'hi' && place.description_hi
        ? place.description_hi
        : place.description;

    setInspectedSpot({
      title,
      category,
      description,
      lat: place.latitude,
      lon: place.longitude,
      placeObj: place,
    });

    if (speakerMode === 'auto') {
      speakAnnouncement(`${title}. ${description}`, lang);
    }
  }

  function apply3DEnhancements(map: maplibregl.Map) {
    try {
      const style = map.getStyle();
      if (!style) return;

      // Enhance map colours: lush campus greenery & clear roads
      style.layers?.forEach((layer) => {
        if (layer.id.includes('park') || layer.id.includes('grass') || layer.id.includes('landuse')) {
          if (layer.type === 'fill') {
            map.setPaintProperty(layer.id, 'fill-color', '#cbe5c0');
          }
        }
        if (layer.id.includes('water') && layer.type === 'fill') {
          map.setPaintProperty(layer.id, 'fill-color', '#8cc9f0');
        }
      });

      if (style.sources && 'terrainSource' in style.sources) {
        map.setTerrain({ source: 'terrainSource', exaggeration: 1.2 });
      }

      const hasBuildingLayer = style.layers?.some(
        (l) => l.id === 'gbu-3d-buildings'
      );
      if (!hasBuildingLayer && style.sources) {
        const vectorSourceKey = Object.keys(style.sources).find(
          (k) => style.sources[k]?.type === 'vector'
        );
        if (vectorSourceKey) {
          const labelLayerId = style.layers?.find(
            (l) => l.type === 'symbol' && l.layout && 'text-field' in l.layout
          )?.id;

          map.addLayer(
            {
              id: 'gbu-3d-buildings',
              source: vectorSourceKey,
              'source-layer': 'building',
              filter: ['any', ['has', 'render_height'], ['has', 'height']],
              type: 'fill-extrusion',
              minzoom: 14.2,
              paint: {
                'fill-extrusion-color': [
                  'interpolate',
                  ['linear'],
                  ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
                  0,
                  '#d6e6cf',
                  15,
                  '#a7cca0',
                  30,
                  '#7eb083',
                ],
                'fill-extrusion-height': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  14.2,
                  0,
                  15.0,
                  ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
                ],
                'fill-extrusion-base': [
                  'coalesce',
                  ['get', 'render_min_height'],
                  ['get', 'min_height'],
                  0,
                ],
                'fill-extrusion-opacity': 0.88,
              },
            },
            labelLayerId
          );
        }
      }
    } catch {
      // Keep base map cleanly
    }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setMapReady(false);
    map.setStyle(buildMapStyle(styleMode));
    map.once('styledata', () => {
      registerArrowIcon(map);
      setMapReady(true);
      apply3DEnhancements(map);
      syncRouteAndMarkers();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleMode]);

  function syncRouteAndMarkers() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    registerArrowIcon(map);

    const routeGeoJson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features:
        route && route.coordinates.length >= 2
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: route.coordinates,
                },
              },
            ]
          : [],
    };

    const existingSource = map.getSource('gbu-route-source') as
      | maplibregl.GeoJSONSource
      | undefined;

    if (existingSource) {
      existingSource.setData(routeGeoJson);
    } else {
      map.addSource('gbu-route-source', {
        type: 'geojson',
        data: routeGeoJson,
      });
      // Outer dark casing for high contrast
      map.addLayer({
        id: 'gbu-route-casing',
        type: 'line',
        source: 'gbu-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0b2b4a', 'line-width': 11, 'line-opacity': 0.92 },
      });
      // Vibrant Google-Navigation style blue-cyan route line
      map.addLayer({
        id: 'gbu-route-line',
        type: 'line',
        source: 'gbu-route-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#1d8cf8', 'line-width': 7, 'line-opacity': 1 },
      });
      // Direction arrows spaced continuously along the route
      map.addLayer({
        id: 'gbu-route-arrows',
        type: 'symbol',
        source: 'gbu-route-source',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 48,
          'icon-image': 'route-direction-arrow',
          'icon-size': 0.65,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }

    placeMarkersRef.current.forEach((m) => m.remove());
    placeMarkersRef.current = [];

    places.forEach((place) => {
      const isDest = place.id === destination.id;
      const el = document.createElement('div');
      el.className = isDest ? 'ml-pin ml-pin-dest' : 'ml-pin ml-pin-place';
      el.title = lang === 'hi' && place.name_hi ? place.name_hi : place.name;
      el.textContent = isDest ? '★' : '●';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        inspectPlace(place);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([place.longitude, place.latitude])
        .addTo(map);
      placeMarkersRef.current.push(marker);
    });

    landmarks.forEach((lm) => {
      const el = document.createElement('div');
      el.className = 'ml-pin ml-pin-landmark';
      el.title = lm.landmark_name;
      el.textContent = '◆';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const title =
          lang === 'hi' && lm.name_hi ? lm.name_hi : lm.landmark_name;
        const desc =
          lang === 'hi'
            ? lm.announcement_hi || lm.announcement || lm.relative_position || ''
            : lm.announcement || lm.relative_position || '';
        setInspectedSpot({
          title,
          category: lang === 'hi' ? 'प्रमुख लैंडमार्क' : 'CAMPUS LANDMARK',
          description: desc,
          lat: lm.latitude,
          lon: lm.longitude,
        });
        if (speakerMode === 'auto') {
          speakAnnouncement(`${title}. ${desc}`, lang);
        }
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lm.longitude, lm.latitude])
        .addTo(map);
      placeMarkersRef.current.push(marker);
    });

    if (startPoint) {
      const startEl = document.createElement('div');
      startEl.className = 'ml-pin ml-pin-start';
      startEl.textContent = 'S';
      const startMarker = new maplibregl.Marker({ element: startEl })
        .setLngLat([startPoint[1], startPoint[0]])
        .addTo(map);
      placeMarkersRef.current.push(startMarker);
    }
  }

  useEffect(() => {
    if (!mapReady) return;
    syncRouteAndMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, route, destination, places, landmarks, startPoint, lang, speakerMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (followUser && liveGps) {
      map.easeTo({
        center: [liveGps[1], liveGps[0]],
        bearing:
          headingDeg !== null && Number.isFinite(headingDeg)
            ? headingDeg
            : map.getBearing(),
        pitch: Math.max(55, map.getPitch()),
        zoom: Math.max(17.5, map.getZoom()),
        duration: 600,
      });
      return;
    }

    if (route && route.coordinates.length >= 2) {
      const bounds = new maplibregl.LngLatBounds();
      route.coordinates.forEach((coord) => {
        if (coord.length >= 2) bounds.extend([coord[0], coord[1]]);
      });
      map.fitBounds(bounds, {
        padding: { top: 85, bottom: 110, left: 70, right: 70 },
        pitch: 58,
        bearing: -12,
        maxZoom: 18,
        duration: 850,
      });
    } else {
      map.flyTo({
        center: [destination.longitude, destination.latitude],
        zoom: 16.8,
        pitch: 60,
        bearing: -15,
        duration: 750,
      });
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
      el.innerHTML =
        '<div class="ml-gps-arrow"></div><div class="ml-gps-dot"></div>';
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

    if (followUser) {
      map.easeTo({
        center: [liveGps[1], liveGps[0]],
        bearing:
          headingDeg !== null && Number.isFinite(headingDeg)
            ? headingDeg
            : map.getBearing(),
        duration: 500,
      });
    }
  }, [liveGps, headingDeg, followUser]);

  function setCameraPitch(nextPitch: number) {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: Math.max(0, Math.min(70, nextPitch)), duration: 400 });
  }

  function rotateCamera(deltaDeg: number) {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ bearing: map.getBearing() + deltaDeg, duration: 350 });
  }

  function fitOverview() {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new maplibregl.LngLatBounds();
    if (route && route.coordinates.length >= 2) {
      route.coordinates.forEach((c) => {
        if (c.length >= 2) bounds.extend([c[0], c[1]]);
      });
    } else {
      places.forEach((p) => bounds.extend([p.longitude, p.latitude]));
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 90, left: 60, right: 60 },
        pitch: 45,
        bearing: 0,
        duration: 700,
      });
    }
  }

  function reset3DCamera() {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [destination.longitude, destination.latitude],
      zoom: 16.8,
      pitch: 60,
      bearing: -15,
      duration: 550,
    });
  }

  return (
    <div className="map3d-shell">
      <div className="map3d-toolbar">
        <div className="style-switcher">
          <button
            type="button"
            className={styleMode === 'hybrid' ? 'active' : ''}
            onClick={() => setStyleMode('hybrid')}
          >
            <Layers size={14} />
            {lang === 'hi' ? '3D मैप' : '3D Map'}
          </button>
          <button
            type="button"
            className={styleMode === 'satellite' ? 'active' : ''}
            onClick={() => setStyleMode('satellite')}
          >
            <Mountain size={14} />
            {lang === 'hi' ? 'सैटेलाइट' : 'Satellite'}
          </button>
          <button
            type="button"
            className={styleMode === 'street' ? 'active' : ''}
            onClick={() => setStyleMode('street')}
          >
            {lang === 'hi' ? 'स्ट्रीट' : 'Street'}
          </button>
        </div>

        <div className="camera-actions">
          <button
            type="button"
            className={pitch >= 35 ? 'active' : ''}
            onClick={() => setCameraPitch(pitch >= 35 ? 0 : 60)}
            title="Toggle 3D Tilt"
          >
            <Eye size={14} />
            3D {pitch}°
          </button>
          <button
            type="button"
            onClick={() => rotateCamera(-30)}
            title="Rotate Left"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={() => rotateCamera(30)}
            title="Rotate Right"
          >
            <RotateCw size={14} />
          </button>
          <button type="button" onClick={fitOverview} title="Overview">
            <Maximize2 size={14} />
            {lang === 'hi' ? 'ओवरव्यू' : 'Overview'}
          </button>
          <button type="button" onClick={reset3DCamera} title="Reset 3D Angle">
            <Compass size={14} />
            {bearing}°
          </button>
          <button
            type="button"
            className={followUser ? 'active' : ''}
            onClick={onToggleFollow}
          >
            <LocateFixed size={14} />
            {lang === 'hi' ? 'फॉलो' : 'Follow'}
          </button>
        </div>
      </div>

      {/* Campus Places & Landmarks Strip — click any place to inspect full detail */}
      <div className="landmark-guide-strip">
        {places.map((pl) => {
          const title = lang === 'hi' && pl.name_hi ? pl.name_hi : pl.name;
          return (
            <button
              key={pl.id}
              type="button"
              className={
                inspectedSpot?.title === title ? 'guide-chip active' : 'guide-chip'
              }
              onClick={() => {
                inspectPlace(pl);
                mapRef.current?.flyTo({
                  center: [pl.longitude, pl.latitude],
                  zoom: 17.5,
                  pitch: 62,
                  duration: 750,
                });
              }}
            >
              <MapPin size={12} />
              {title}
            </button>
          );
        })}
      </div>

      {/* Detailed Info Card for any clicked or visited place on map */}
      {inspectedSpot && (
        <div className="landmark-narrator-card">
          <div className="narrator-head">
            <div>
              <small className="narrator-cat">{inspectedSpot.category}</small>
              <b>{inspectedSpot.title}</b>
            </div>
            <button
              type="button"
              onClick={() => setInspectedSpot(null)}
              aria-label="Close detail card"
            >
              <X size={16} />
            </button>
          </div>
          <p>{inspectedSpot.description}</p>
          <div className="narrator-actions">
            <button
              type="button"
              className="narrator-mini-btn"
              onClick={() =>
                speakAnnouncement(
                  `${inspectedSpot.title}. ${inspectedSpot.description}`,
                  lang
                )
              }
            >
              <Volume2 size={13} />
              {lang === 'hi' ? 'सुनें' : 'Listen'}
            </button>

            {inspectedSpot.placeObj &&
              inspectedSpot.placeObj.id !== destination.id &&
              onSelectNewDestination && (
                <button
                  type="button"
                  className="narrator-mini-btn primary"
                  onClick={() => {
                    onSelectNewDestination(inspectedSpot.placeObj!);
                    setInspectedSpot(null);
                  }}
                >
                  <Navigation size={13} />
                  {lang === 'hi' ? 'यहाँ चलें' : 'Go Here'}
                </button>
              )}
          </div>
        </div>
      )}

      <div className="map3d-tilt-dock">
        <span>{lang === 'hi' ? '3D टिल्ट' : '3D Tilt'}</span>
        <input
          type="range"
          min={0}
          max={68}
          value={pitch}
          onChange={(e) => setCameraPitch(Number(e.target.value))}
          aria-label="3D Camera Tilt"
        />
        <b>{pitch}°</b>
      </div>

      {mapFallbackNotice && (
        <div className="map3d-notice">{mapFallbackNotice}</div>
      )}

      {pickPinMode && !route && (
        <div className="map3d-pick-banner">
          {lang === 'hi'
            ? '📍 मैप पर किसी भी जगह या बिल्डिंग पर क्लिक करें — रास्ता और पूरी जानकारी दोनों दिखेंगी'
            : '📍 Click any place or building on the map to drop Start (S) pin or inspect details'}
        </div>
      )}
      <div ref={containerRef} className="map3d-canvas" />
    </div>
  );
}