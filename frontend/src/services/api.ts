import centralLocations from '../data/campusLocations.json';
import { Landmark, Place, RouteData } from '../types/navigation';

export const API_BASE_URL: string = (
  import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'
).replace(/\/+$/, '');

export const MAPTILER_KEY: string = (
  import.meta.env.VITE_MAPTILER_KEY || ''
).trim();

export const GOOGLE_MAPS_API_KEY: string = (
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
).trim();

// Authoritative Gate No. 1 coordinates [lat, lon]
export const GATE_NO_1_COORDINATES: [number, number] = [28.416559, 77.517199];

export function normalizePlaces(raw: Place[]): Place[] {
  const verifiedOnly = raw.filter(
    (item) => (item.status || 'Verified') === 'Verified'
  );
  return verifiedOnly.map((place) =>
    place.id === 'B001'
      ? {
          ...place,
          latitude: GATE_NO_1_COORDINATES[0],
          longitude: GATE_NO_1_COORDINATES[1],
          google_maps_link: buildGateNo1GoogleMapsUrl(),
          status: 'Verified',
        }
      : {
          ...place,
          status: 'Verified',
        }
  );
}

export function getCentralFallbackPlaces(): Place[] {
  return normalizePlaces(centralLocations as Place[]);
}

export function buildGateNo1GoogleMapsUrl(origin?: [number, number] | null): string {
  const base =
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${GATE_NO_1_COORDINATES[0]},${GATE_NO_1_COORDINATES[1]}` +
    `&travelmode=walking`;
  if (origin && Number.isFinite(origin[0]) && Number.isFinite(origin[1])) {
    return `${base}&origin=${origin[0]},${origin[1]}`;
  }
  return base;
}

export function buildDestinationGoogleMapsUrl(
  dest: Place,
  origin?: [number, number] | null
): string {
  const base =
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${dest.latitude},${dest.longitude}` +
    `&travelmode=walking`;
  if (origin && Number.isFinite(origin[0]) && Number.isFinite(origin[1])) {
    return `${base}&origin=${origin[0]},${origin[1]}`;
  }
  return base;
}

export async function fetchVerifiedLocations(): Promise<{
  places: Place[];
  fromBackend: boolean;
}> {
  try {
    const res = await fetch(`${API_BASE_URL}/locations`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Place[];
    if (!Array.isArray(data) || data.length === 0) {
      return { places: getCentralFallbackPlaces(), fromBackend: false };
    }
    return { places: normalizePlaces(data), fromBackend: true };
  } catch {
    return { places: getCentralFallbackPlaces(), fromBackend: false };
  }
}


export function getCentralFallbackLandmarks(): Landmark[] {
  return [
    {
      landmark_id: 'L001',
      building_id: 'B003',
      landmark_name: 'Meditation Centre',
      name_hi: 'ध्यान केंद्र (मेडिटेशन सेंटर)',
      relative_position: 'On your right side along the main campus pathway',
      announcement:
        'Meditation Centre is nearby on your right. It is the peaceful meditation and relaxation centre of GBU, located before the central roundabout.',
      announcement_hi:
        'ध्यान केंद्र (मेडिटेशन सेंटर) आपके दाईं तरफ़ पास में है। यह जीबीयू का शांत ध्यान और विश्राम केंद्र है, जो मुख्य चौराहे से पहले स्थित है।',
      latitude: 28.419495,
      longitude: 77.519195,
    },
    {
      landmark_id: 'L002',
      building_id: 'B004',
      landmark_name: 'School of Management',
      name_hi: 'स्कूल ऑफ मैनेजमेंट',
      relative_position: 'Alongside the central academic avenue',
      announcement:
        'School of Management is nearby. This academic block houses the management department and sits adjacent to the central campus road.',
      announcement_hi:
        'स्कूल ऑफ मैनेजमेंट पास में है। यह प्रबंधन संकाय का मुख्य शैक्षणिक भवन है और केंद्रीय परिसर मार्ग के किनारे स्थित है।',
      latitude: 28.417256,
      longitude: 77.522084,
    },
    {
      landmark_id: 'L003',
      building_id: 'B002',
      landmark_name: 'GBU Admin Department',
      name_hi: 'जीबीयू प्रशासनिक विभाग',
      relative_position: 'Opposite side of School of Management',
      announcement:
        'GBU Admin Department is nearby on the opposite side. It houses the university administrative offices and central governance wing.',
      announcement_hi:
        'जीबीयू प्रशासनिक विभाग दूसरी तरफ़ पास में है। यहाँ विश्वविद्यालय के मुख्य प्रशासनिक कार्यालय और प्रशासन विंग स्थित हैं।',
      latitude: 28.415914,
      longitude: 77.520973,
    },
    {
      landmark_id: 'L004',
      building_id: 'B005',
      landmark_name: 'School of ICT',
      name_hi: 'स्कूल ऑफ आईसीटी',
      relative_position: 'End of the academic corridor',
      announcement:
        'School of ICT is right ahead. You are approaching the Information and Communication Technology academic building.',
      announcement_hi:
        'स्कूल ऑफ आईसीटी ठीक सामने है। आप सूचना एवं संचार प्रौद्योगिकी के मुख्य शैक्षणिक भवन के पास पहुँच गए हैं।',
      latitude: 28.416659,
      longitude: 77.52348,
    },
  ];
}

export async function fetchLandmarks(): Promise<Landmark[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/landmarks`);
    if (!res.ok) return getCentralFallbackLandmarks();
    const data = await res.json();
    return Array.isArray(data) && data.length > 0
      ? data
      : getCentralFallbackLandmarks();
  } catch {
    return getCentralFallbackLandmarks();
  }
}

export async function requestWalkingRoute(
  start: [number, number],
  destination: Place
): Promise<RouteData> {
  const res = await fetch(`${API_BASE_URL}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start_lat: start[0],
      start_lon: start[1],
      end_lat: destination.latitude,
      end_lon: destination.longitude,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = payload?.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : detail?.error || `Routing service returned HTTP ${res.status}`;
    const fallbackUrl =
      (typeof detail === 'object' && detail?.google_maps_fallback) ||
      buildDestinationGoogleMapsUrl(destination, start);
    const err = new Error(message) as Error & { fallbackUrl?: string };
    err.fallbackUrl = fallbackUrl;
    throw err;
  }

  return payload as RouteData;
}
