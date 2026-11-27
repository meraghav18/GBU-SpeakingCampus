import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GpsTelemetry,
  Landmark,
  NavLifecycleState,
  Place,
  RouteData,
  StartMode,
} from '../types/navigation';
import {
  buildDestinationGoogleMapsUrl,
  buildGateNo1GoogleMapsUrl,
  GATE_NO_1_COORDINATES,
  requestWalkingRoute,
} from '../services/api';

const OFF_ROUTE_THRESHOLD_M = 65;
const OFF_ROUTE_CONSECUTIVE_READINGS = 3;
const REROUTE_COOLDOWN_MS = 8000;
const ARRIVAL_THRESHOLD_M = 20;
const LANDMARK_PROXIMITY_M = 40;
const MAX_RELIABLE_GPS_ACCURACY_M = 150;
const CAMPUS_PROXIMITY_RADIUS_M = 2500;

export function haversineMeters(
  a: [number, number],
  b: [number, number]
): number {
  const R = 6371000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function isPositionInsideCampus(
  pos: [number, number],
  places: Place[]
): boolean {
  if (haversineMeters(pos, GATE_NO_1_COORDINATES) <= CAMPUS_PROXIMITY_RADIUS_M) {
    return true;
  }
  return places.some(
    (p) => haversineMeters(pos, [p.latitude, p.longitude]) <= CAMPUS_PROXIMITY_RADIUS_M
  );
}

export function speakAnnouncement(
  text: string,
  lang: 'en' | 'hi',
  onFallbackText?: (msg: string) => void
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onFallbackText?.(text);
    return;
  }

  try {
    const utterance = new SpeechSynthesisUtterance(text);
    const targetPrefix = lang === 'hi' ? 'hi' : 'en';
    const voices = window.speechSynthesis.getVoices();
    const matched = voices.find((v) =>
      v.lang.toLowerCase().startsWith(targetPrefix)
    );
    if (matched) {
      utterance.voice = matched;
    }
    utterance.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    onFallbackText?.(text);
  }
}

export function useLiveNavigation({
  destination,
  places,
  landmarks,
  lang,
}: {
  destination: Place | null;
  places: Place[];
  landmarks: Landmark[];
  lang: 'en' | 'hi';
}) {
  const gatePlace =
    places.find((p) => p.id === 'B001') ||
    places[0] || {
      id: 'B001',
      name: 'GBU Gate No. 1',
      name_hi: 'जीबीयू गेट नं. 1',
      category: 'Entrance',
      category_hi: 'मुख्य द्वार',
      latitude: GATE_NO_1_COORDINATES[0],
      longitude: GATE_NO_1_COORDINATES[1],
      google_maps_link: buildGateNo1GoogleMapsUrl(),
      description: 'Main entrance of GBU.',
      description_hi: 'गौतम बुद्ध विश्वविद्यालय का मुख्य प्रवेश द्वार।',
      status: 'Verified' as const,
    };

  const [startMode, setStartMode] = useState<StartMode>('map-pin');
  const [manualStartId, setManualStartId] = useState<string>('');
  const [mapPinCoords, setMapPinCoords] = useState<[number, number] | null>(null);
  const [pickPinActive, setPickPinActive] = useState<boolean>(true);
  const [navState, setNavState] = useState<NavLifecycleState>('idle');
  const [followUser, setFollowUser] = useState<boolean>(true);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [loadingRoute, setLoadingRoute] = useState<boolean>(false);
  const [rerouting, setRerouting] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string>('');
  const [fallbackMapsUrl, setFallbackMapsUrl] = useState<string>('');
  const [routeProgressPct, setRouteProgressPct] = useState<number>(0);
  const [remainingDistanceM, setRemainingDistanceM] = useState<number | null>(null);
  const [remainingDurationS, setRemainingDurationS] = useState<number | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [liveAnnouncementText, setLiveAnnouncementText] = useState<string>('');

  const [gps, setGps] = useState<GpsTelemetry>({
    coords: null,
    accuracyM: null,
    headingDeg: null,
    permissionState: 'unknown',
    statusMessage: '',
    errorMessage: '',
    outsideCampus: false,
    lowAccuracyLaptopIp: false,
  });

  const announcedIdsRef = useRef<Set<string>>(new Set());
  const offRouteStreakRef = useRef<number>(0);
  const lastRerouteTimeRef = useRef<number>(0);
  const rerouteInFlightRef = useRef<boolean>(false);

  const selectedManualStart =
    places.find((p) => p.id === manualStartId) || null;

  const effectiveStartPoint: [number, number] | null = (() => {
    if (startMode === 'map-pin') {
      return mapPinCoords;
    }
    if (startMode === 'gate') {
      return [GATE_NO_1_COORDINATES[0], GATE_NO_1_COORDINATES[1]];
    }
    if (startMode === 'manual') {
      if (!selectedManualStart) return null;
      return [selectedManualStart.latitude, selectedManualStart.longitude];
    }
    if (startMode === 'gps') {
      if (gps.lowAccuracyLaptopIp && mapPinCoords) {
        return mapPinCoords;
      }
      return gps.coords;
    }
    return null;
  })();

  const handleSelectMapPin = useCallback(
    (coords: [number, number]) => {
      setMapPinCoords(coords);
      setStartMode('map-pin');
      setRouteError('');
    },
    []
  );

  const detectCurrentLocation = useCallback(() => {
    setStartMode('gps');
    setRouteError('');
    setFallbackMapsUrl('');

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const msg =
        lang === 'hi'
          ? 'इस ब्राउज़र में GPS समर्थित नहीं है। कृपया 3D मैप पर अपने हॉस्टल पर क्लिक करें।'
          : 'Geolocation is not supported in this browser. Click your hostel on the 3D map instead.';
      setGps((prev) => ({
        ...prev,
        permissionState: 'unsupported',
        errorMessage: msg,
        statusMessage: '',
      }));
      return;
    }

    setGps((prev) => ({
      ...prev,
      errorMessage: '',
      statusMessage:
        lang === 'hi' ? 'GPS लोकेशन खोजी जा रही है…' : 'Detecting your GPS location…',
    }));

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [
          pos.coords.latitude,
          pos.coords.longitude,
        ];
        const acc = Number.isFinite(pos.coords.accuracy)
          ? Math.round(pos.coords.accuracy)
          : null;
        const hdg =
          pos.coords.heading !== null && Number.isFinite(pos.coords.heading)
            ? pos.coords.heading
            : null;
        const lowAcc = acc !== null && acc > MAX_RELIABLE_GPS_ACCURACY_M;
        const outside = !lowAcc && !isPositionInsideCampus(coords, places);

        if (lowAcc) {
          setStartMode('map-pin');
          setPickPinActive(true);
        }

        setGps({
          coords,
          accuracyM: acc,
          headingDeg: hdg,
          permissionState: 'granted',
          outsideCampus: outside,
          lowAccuracyLaptopIp: lowAcc,
          errorMessage: '',
          statusMessage: lowAcc
            ? lang === 'hi'
              ? `लैपटॉप का Wi-Fi/IP लोकेशन ±${acc} m दूर दिख रहा है। अपने हॉस्टल से सीधा रास्ता बनाने के लिए 3D मैप पर अपने हॉस्टल पर क्लिक करें!`
              : `Your laptop reported a coarse Wi-Fi/IP location (±${acc} m). Click directly on your hostel on the 3D map to route straight to ${
                  destination?.name || 'your destination'
                }!`
            : outside
            ? lang === 'hi'
              ? 'आप कैंपस के बाहर हैं। यदि आप हॉस्टल के अंदर हैं तो मैप पर अपनी जगह क्लिक करें।'
              : 'GPS appears outside campus. If you are inside your hostel, click your hostel on the 3D map.'
            : lang === 'hi'
            ? 'कैंपस के अंदर सटीक GPS लोकेशन मिल गई।'
            : 'Accurate GPS location detected inside campus.',
        });
      },
      (err) => {
        const isDenied = err.code === err.PERMISSION_DENIED;
        const isTimeout = err.code === err.TIMEOUT;
        const msg = isDenied
          ? lang === 'hi'
            ? 'GPS अनुमति बंद है। 3D मैप पर अपने हॉस्टल पर क्लिक करके रास्ता बनाएँ।'
            : 'Location permission denied. Click your hostel on the 3D map to start routing.'
          : isTimeout
          ? lang === 'hi'
            ? 'GPS समय समाप्त (Timeout)। 3D मैप पर अपने हॉस्टल पर क्लिक करें।'
            : 'GPS timed out. Click your hostel directly on the 3D map.'
          : lang === 'hi'
          ? 'GPS उपलब्ध नहीं है। 3D मैप पर अपने हॉस्टल पर क्लिक करें।'
          : 'GPS unavailable. Click your hostel directly on the 3D map.';

        setStartMode('map-pin');
        setPickPinActive(true);
        setGps((prev) => ({
          ...prev,
          permissionState: isDenied ? 'denied' : prev.permissionState,
          errorMessage: msg,
          statusMessage: '',
        }));
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  }, [destination?.name, lang, places]);

  const startNavigation = useCallback(async () => {
    if (!destination) return;

    const origin = effectiveStartPoint;
    if (!origin) {
      setPickPinActive(true);
      setRouteError(
        lang === 'hi'
          ? 'पहले 3D मैप पर अपने हॉस्टल की जगह क्लिक करें, फिर नेविगेशन शुरू करें।'
          : 'Click your hostel location on the 3D map first, then press Start Direct Walking Navigation.'
      );
      return;
    }

    setLoadingRoute(true);
    setRouteError('');
    setFallbackMapsUrl('');
    announcedIdsRef.current.clear();
    offRouteStreakRef.current = 0;

    try {
      const data = await requestWalkingRoute(origin, destination);
      setRoute(data);
      setRemainingDistanceM(data.distance_m);
      setRemainingDurationS(data.duration_s);
      setActiveStepIndex(0);
      setRouteProgressPct(0);

      if (startMode === 'gps' && gps.coords && !gps.errorMessage && !gps.lowAccuracyLaptopIp) {
        setNavState('navigating');
        setFollowUser(true);
      } else {
        setNavState('idle');
      }

      const welcome =
        lang === 'hi'
          ? `आपके स्थान से ${destination.name_hi || destination.name} तक का सीधा पैदल रास्ता तैयार है।`
          : `Direct walking route from your location to ${destination.name} is ready.`;
      speakAnnouncement(welcome, lang, (fallback) => setLiveAnnouncementText(fallback));
    } catch (err) {
      const typedErr = err as Error & { fallbackUrl?: string };
      setRoute(null);
      setNavState('idle');
      setRouteError(
        typedErr.message ||
          (lang === 'hi'
            ? 'पैदल रूटिंग सेवा उपलब्ध नहीं है।'
            : 'Pedestrian routing service is unavailable.')
      );
      setFallbackMapsUrl(
        typedErr.fallbackUrl || buildDestinationGoogleMapsUrl(destination, origin)
      );
    } finally {
      setLoadingRoute(false);
    }
  }, [destination, effectiveStartPoint, gps.coords, gps.errorMessage, gps.lowAccuracyLaptopIp, lang, startMode]);

  const pauseNavigation = useCallback(() => {
    if (navState === 'navigating') setNavState('paused');
  }, [navState]);

  const resumeNavigation = useCallback(() => {
    if (navState === 'paused' && gps.coords && !gps.errorMessage && !gps.lowAccuracyLaptopIp) {
      setNavState('navigating');
      setFollowUser(true);
    } else if (navState === 'paused') {
      detectCurrentLocation();
    }
  }, [detectCurrentLocation, gps.coords, gps.errorMessage, gps.lowAccuracyLaptopIp, navState]);

  const stopNavigation = useCallback(() => {
    setNavState('idle');
    setRerouting(false);
    offRouteStreakRef.current = 0;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const recenterMap = useCallback(() => {
    setFollowUser(true);
    if (startMode === 'gps' && !gps.coords) {
      detectCurrentLocation();
    }
  }, [detectCurrentLocation, gps.coords, startMode]);

  const speakCurrentOrAllDirections = useCallback(() => {
    if (!route || route.steps.length === 0) return;
    const text = route.steps.map((s) => s.instruction).join('. ');
    speakAnnouncement(text, lang, (fallback) => setLiveAnnouncementText(fallback));
  }, [lang, route]);

  useEffect(() => {
    if (navState !== 'navigating' || !route || !destination) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNavState('paused');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const current: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        const acc = Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null;
        const hdg = pos.coords.heading !== null && Number.isFinite(pos.coords.heading) ? pos.coords.heading : null;
        if (acc !== null && acc > MAX_RELIABLE_GPS_ACCURACY_M) return;

        const outside = !isPositionInsideCampus(current, places);
        setGps({
          coords: current,
          accuracyM: acc,
          headingDeg: hdg,
          permissionState: 'granted',
          outsideCampus: outside,
          lowAccuracyLaptopIp: false,
          errorMessage: '',
          statusMessage: lang === 'hi' ? 'लाइव GPS सक्रिय है।' : 'Live GPS active.',
        });

        const distToDest = haversineMeters(current, [destination.latitude, destination.longitude]);
        if (distToDest <= ARRIVAL_THRESHOLD_M) {
          setNavState('arrived');
          setRouteProgressPct(100);
          setRemainingDistanceM(0);
          setRemainingDurationS(0);
          const arrivedMsg =
            lang === 'hi'
              ? `आप ${destination.name_hi || destination.name} पर पहुँच गए हैं।`
              : `You have arrived at ${destination.name}.`;
          setLiveAnnouncementText(arrivedMsg);
          speakAnnouncement(arrivedMsg, lang);
          return;
        }

        const pathLatLon: [number, number][] = route.coordinates.map(
          (c) => [c[1], c[0]] as [number, number]
        );
        let nearestDistM = Infinity;
        let nearestIdx = 0;
        for (let i = 0; i < pathLatLon.length; i += 1) {
          const d = haversineMeters(current, pathLatLon[i]);
          if (d < nearestDistM) {
            nearestDistM = d;
            nearestIdx = i;
          }
        }

        if (pathLatLon.length > 1) {
          const pct = Math.min(99, Math.max(0, Math.round((nearestIdx / (pathLatLon.length - 1)) * 100)));
          setRouteProgressPct(pct);
          const ratioRemaining = Math.max(0, 1 - pct / 100);
          setRemainingDistanceM(Math.round(route.distance_m * ratioRemaining));
          setRemainingDurationS(Math.round(route.duration_s * ratioRemaining));
          if (route.steps.length > 0) {
            setActiveStepIndex(Math.min(route.steps.length - 1, Math.floor((pct / 100) * route.steps.length)));
          }
        }

        for (const lm of landmarks) {
          const key = lm.landmark_id || lm.landmark_name;
          if (announcedIdsRef.current.has(key)) continue;
          if (haversineMeters(current, [lm.latitude, lm.longitude]) <= LANDMARK_PROXIMITY_M) {
            announcedIdsRef.current.add(key);
            const lmTitle = lang === 'hi' && lm.name_hi ? lm.name_hi : lm.landmark_name;
            const richAnnouncement =
              lang === 'hi'
                ? lm.announcement_hi || `${lmTitle} पास आ रहा है। ${lm.description_hi || ''}`.trim()
                : lm.announcement || `${lmTitle} is nearby. ${lm.description || ''}`.trim();
            setLiveAnnouncementText(richAnnouncement);
            speakAnnouncement(richAnnouncement, lang);
          }
        }

        if (nearestDistM > OFF_ROUTE_THRESHOLD_M) {
          offRouteStreakRef.current += 1;
        } else {
          offRouteStreakRef.current = 0;
        }

        const now = Date.now();
        if (
          offRouteStreakRef.current >= OFF_ROUTE_CONSECUTIVE_READINGS &&
          !rerouteInFlightRef.current &&
          now - lastRerouteTimeRef.current > REROUTE_COOLDOWN_MS
        ) {
          rerouteInFlightRef.current = true;
          lastRerouteTimeRef.current = now;
          setRerouting(true);
          try {
            const refreshed = await requestWalkingRoute(current, destination);
            setRoute(refreshed);
            setRemainingDistanceM(refreshed.distance_m);
            setRemainingDurationS(refreshed.duration_s);
            setActiveStepIndex(0);
            offRouteStreakRef.current = 0;
          } finally {
            setRerouting(false);
            rerouteInFlightRef.current = false;
          }
        }
      },
      () => setNavState('paused'),
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [destination, lang, landmarks, navState, places, route]);

  return {
    gatePlace,
    startMode,
    setStartMode,
    manualStartId,
    setManualStartId,
    selectedManualStart,
    mapPinCoords,
    pickPinActive,
    setPickPinActive,
    handleSelectMapPin,
    effectiveStartPoint,
    navState,
    followUser,
    setFollowUser,
    route,
    loadingRoute,
    rerouting,
    routeError,
    fallbackMapsUrl,
    routeProgressPct,
    remainingDistanceM,
    remainingDurationS,
    activeStepIndex,
    liveAnnouncementText,
    gps,
    detectCurrentLocation,
    startNavigation,
    pauseNavigation,
    resumeNavigation,
    stopNavigation,
    recenterMap,
    speakCurrentOrAllDirections,
  };
}