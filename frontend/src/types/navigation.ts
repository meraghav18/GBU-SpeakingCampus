export type VerificationStatus = 'Verified' | 'Pending Verification';

export type Place = {
  id: string;
  name: string;
  name_hi?: string;
  category: string;
  category_hi?: string;
  latitude: number;
  longitude: number;
  google_maps_link: string;
  description: string;
  description_hi?: string;
  status?: VerificationStatus;
};

export type RouteStep = {
  instruction: string;
  distance_m: number;
  duration_s?: number;
  coordinate?: [number, number] | null;
};

export type RouteData = {
  source: string;
  profile?: string;
  estimated: boolean;
  warning?: string;
  distance_m: number;
  duration_s: number;
  coordinates: number[][]; // [lon, lat]
  steps: RouteStep[];
  landmarks?: Landmark[];
};

export type Landmark = {
  landmark_id: string;
  route_id?: string;
  sequence?: number;
  building_id?: string;
  landmark_name: string;
  name?: string;
  name_hi?: string;
  relative_position?: string;
  announcement?: string;
  announcement_hi?: string;
  description?: string;
  description_hi?: string;
  verification_status?: string;
  latitude: number;
  longitude: number;
};

export type StartMode = 'gps' | 'map-pin' | 'manual' | 'gate';

export type NavLifecycleState = 'idle' | 'navigating' | 'paused' | 'arrived';

export type GpsTelemetry = {
  coords: [number, number] | null; // [lat, lon]
  accuracyM: number | null;
  headingDeg: number | null;
  permissionState: 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';
  statusMessage: string;
  errorMessage: string;
  outsideCampus: boolean;
  lowAccuracyLaptopIp: boolean;
};

export type MapStyleMode = 'hybrid' | 'satellite' | 'street';