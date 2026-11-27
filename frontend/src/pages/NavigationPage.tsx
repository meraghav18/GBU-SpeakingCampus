import {
  ArrowLeft,
  Compass,
  ExternalLink,
  Footprints,
  LocateFixed,
  MapPin,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Volume2,
} from 'lucide-react';
import Map3DView from '../components/Map3DView';
import { useLiveNavigation } from '../hooks/useLiveNavigation';
import { Landmark, Place } from '../types/navigation';

type NavigationPageProps = {
  destination: Place;
  places: Place[];
  landmarks: Landmark[];
  lang: 'en' | 'hi';
  onBackHome: () => void;
  onChangeDestination: (place: Place) => void;
};

export default function NavigationPage({
  destination,
  places,
  landmarks,
  lang,
  onBackHome,
  onChangeDestination,
}: NavigationPageProps) {
  const nav = useLiveNavigation({ destination, places, landmarks, lang });

  const destTitle =
    lang === 'hi' && destination.name_hi ? destination.name_hi : destination.name;
  const destDesc =
    lang === 'hi' && destination.description_hi
      ? destination.description_hi
      : destination.description;

  const displayDistanceM =
    nav.remainingDistanceM !== null && nav.navState !== 'idle'
      ? nav.remainingDistanceM
      : nav.route?.distance_m ?? null;
  const displayDurationS =
    nav.remainingDurationS !== null && nav.navState !== 'idle'
      ? nav.remainingDurationS
      : nav.route?.duration_s ?? null;

  const currentStep =
    nav.route && nav.route.steps.length > 0
      ? nav.route.steps[Math.min(nav.activeStepIndex, nav.route.steps.length - 1)]
      : null;

  const copy =
    lang === 'hi'
      ? {
          back: 'होम पेज पर वापस जाएँ',
          eyebrow: 'GBU CAMPUSGUIDE / 3D नेविगेशन',
          selected: 'चुनी गई मंज़िल',
          changeDest: 'मंज़िल बदलें',
          from: 'शुरुआती स्थान चुनें',
          manual: 'मैनुअल स्थान चुनें',
          gps: 'मेरी GPS लोकेशन पता करें',
          gate: 'GBU Gate No. 1 से शुरू करें',
          startNav: 'कैंपस नेविगेशन शुरू करें',
          loading: 'पैदल रास्ता खोज रहे हैं…',
          pause: 'रोकें (Pause)',
          resume: 'फिर शुरू करें (Resume)',
          stop: 'बंद करें (Stop)',
          recenter: 'रीसेंटर',
          distance: 'दूरी',
          eta: 'अनुमानित पैदल समय',
          directions: 'पैदल दिशा-निर्देश',
          speak: 'आवाज़ में सुनें',
          outsideTitle: 'आप कैंपस के बाहर हैं',
          outsideBody:
            'पहले GBU Gate No. 1 (28.416559, 77.517199) पहुँचें, फिर वापस आकर कैंपस नेविगेशन शुरू करें।',
          gateMaps: 'Gate No. 1 तक Google Maps रास्ता खोलें',
          extFallback: 'Google Maps में पैदल रास्ता खोलें',
          accuracy: 'GPS सटीकता',
          heading: 'दिशा',
          note: 'केवल सत्यापित कोऑर्डिनेट्स और वास्तविक पैदल रूटिंग का उपयोग किया जाता है। GPS सिग्नल या ऑफ़लाइन स्थिति में बदलाव संभव है।',
        }
      : {
          back: 'Back to home',
          eyebrow: 'GBU CAMPUSGUIDE / 3D NAVIGATION',
          selected: 'Selected destination',
          changeDest: 'Change destination',
          from: 'Starting point',
          manual: 'Select starting point manually',
          gps: 'Detect my GPS location',
          gate: 'Start from GBU Gate No. 1',
          startNav: 'Start Campus Navigation',
          loading: 'Calculating walking route…',
          pause: 'Pause',
          resume: 'Resume',
          stop: 'Stop',
          recenter: 'Recenter',
          distance: 'Distance',
          eta: 'Approx. walk',
          directions: 'Walking directions',
          speak: 'Speak directions',
          outsideTitle: 'You are outside the campus',
          outsideBody:
            'First travel to GBU Gate No. 1 (28.416559, 77.517199), then return here to start campus navigation.',
          gateMaps: 'Open Google Maps to Gate No. 1',
          extFallback: 'Open in Google Maps',
          accuracy: 'Accuracy',
          heading: 'Heading',
          note: 'Uses verified coordinates and pedestrian routing. Verify on-site campus access and live GPS accuracy.',
        };

  return (
    <main className="navigation-page-full">
      <div className="nav-page-topbar">
        <button type="button" className="back-link" onClick={onBackHome}>
          <ArrowLeft size={16} />
          {copy.back}
        </button>

        <div className="dest-switcher">
          <label htmlFor="dest-switch-select">{copy.changeDest}:</label>
          <select
            id="dest-switch-select"
            value={destination.id}
            onChange={(e) => {
              const found = places.find((p) => p.id === e.target.value);
              if (found) onChangeDestination(found);
            }}
          >
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {lang === 'hi' && p.name_hi ? p.name_hi : p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="nav-stage">
        <aside className="floating-nav-panel">
          <span className="eyebrow dark">{copy.eyebrow}</span>
          <h1>{destTitle}</h1>
          <p className="muted">{destDesc}</p>

          <div className="destination-summary">
            <MapPin size={18} />
            <div>
              <small>{copy.selected}</small>
              <b>{destTitle}</b>
              <span className="coord-caption">
                {destination.latitude.toFixed(6)}, {destination.longitude.toFixed(6)}
              </span>
            </div>
          </div>

          <h3>{copy.from}</h3>
          <div className="mode-buttons">
            <button
              type="button"
              className={nav.startMode === 'gps' ? 'active' : ''}
              onClick={nav.detectCurrentLocation}
            >
              <LocateFixed size={17} />
              {copy.gps}
            </button>

            <button
              type="button"
              className={nav.startMode === 'manual' ? 'active' : ''}
              onClick={() => {
                nav.stopNavigation();
                nav.setStartMode('manual');
              }}
            >
              <MapPin size={17} />
              {copy.manual}
            </button>

            <button
              type="button"
              className={nav.startMode === 'gate' ? 'active' : ''}
              onClick={() => {
                nav.stopNavigation();
                nav.setStartMode('gate');
              }}
            >
              <Navigation size={17} />
              {copy.gate}
            </button>
          </div>

          {nav.startMode === 'manual' && (
            <select
              className="manual-start-select"
              value={nav.manualStartId}
              onChange={(e) => nav.setManualStartId(e.target.value)}
            >
              <option value="">{copy.manual}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {lang === 'hi' && p.name_hi ? p.name_hi : p.name}
                </option>
              ))}
            </select>
          )}

          {nav.startMode === 'gps' && (
            <div className="telemetry-box">
              {nav.gps.statusMessage && (
                <div className="gps-status">
                  <ShieldCheck size={16} />
                  <span>{nav.gps.statusMessage}</span>
                </div>
              )}
              {nav.gps.coords && (
                <div className="telemetry-meta">
                  <span>
                    {nav.gps.coords[0].toFixed(6)}, {nav.gps.coords[1].toFixed(6)}
                  </span>
                  {nav.gps.accuracyM !== null && (
                    <span>
                      {copy.accuracy}: ±{nav.gps.accuracyM} m
                    </span>
                  )}
                  {nav.gps.headingDeg !== null && (
                    <span>
                      {copy.heading}: {Math.round(nav.gps.headingDeg)}°
                    </span>
                  )}
                </div>
              )}
              {nav.gps.errorMessage && (
                <div className="error">{nav.gps.errorMessage}</div>
              )}
            </div>
          )}

          {nav.startMode === 'gps' && nav.gps.outsideCampus && nav.gps.coords && (
            <div className="outside-box">
              <b>{copy.outsideTitle}</b>
              <p>{copy.outsideBody}</p>
              <a
                className="google-link-btn"
                href={nav.fallbackMapsUrl || `https://www.google.com/maps/dir/?api=1&origin=${nav.gps.coords[0]},${nav.gps.coords[1]}&destination=28.416559,77.517199&travelmode=walking`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={15} />
                {copy.gateMaps}
              </a>
            </div>
          )}

          <button
            type="button"
            className="primary-button"
            onClick={nav.startNavigation}
            disabled={nav.loadingRoute}
          >
            {nav.loadingRoute ? copy.loading : copy.startNav}
            <Navigation size={18} />
          </button>

          {nav.route && (
            <div className="active-nav-controls">
              {nav.navState === 'navigating' && (
                <button type="button" className="mini-btn" onClick={nav.pauseNavigation}>
                  <Pause size={15} />
                  {copy.pause}
                </button>
              )}
              {nav.navState === 'paused' && (
                <button type="button" className="mini-btn" onClick={nav.resumeNavigation}>
                  <Play size={15} />
                  {copy.resume}
                </button>
              )}
              {(nav.navState === 'navigating' || nav.navState === 'paused') && (
                <button type="button" className="mini-btn danger" onClick={nav.stopNavigation}>
                  <Square size={15} />
                  {copy.stop}
                </button>
              )}
              <button type="button" className="mini-btn" onClick={nav.recenterMap}>
                <RotateCcw size={15} />
                {copy.recenter}
              </button>
            </div>
          )}

          {nav.rerouting && (
            <div className="gps-status">
              <Compass size={16} />
              <span>
                {lang === 'hi'
                  ? 'ऑफ़-रूट मूवमेंट मिला — नया रास्ता निकाला जा रहा है…'
                  : 'Off-route detected — recalculating walking route…'}
              </span>
            </div>
          )}

          {nav.routeError && (
            <div className="error-box">
              <div className="error">{nav.routeError}</div>
              {nav.fallbackMapsUrl && (
                <a
                  className="google-link-btn"
                  href={nav.fallbackMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={15} />
                  {copy.extFallback}
                </a>
              )}
            </div>
          )}

          {nav.route && (
            <>
              <div className="route-stats">
                <div>
                  <small>{copy.distance}</small>
                  <b>
                    {displayDistanceM !== null
                      ? displayDistanceM >= 1000
                        ? `${(displayDistanceM / 1000).toFixed(1)} km`
                        : `${displayDistanceM} m`
                      : '—'}
                  </b>
                </div>

                <div>
                  <small>{copy.eta}</small>
                  <b>
                    {displayDurationS !== null
                      ? `${Math.max(1, Math.round(displayDurationS / 60))} min`
                      : '—'}
                  </b>
                </div>
              </div>

              <div className="route-source">
                <Footprints size={14} />
                <span>
                  {nav.route.source} · {nav.routeProgressPct}%
                </span>
              </div>

              {currentStep && (
                <div className="next-instruction-banner">
                  <small>
                    {lang === 'hi' ? 'अगला निर्देश' : 'Next instruction'}
                  </small>
                  <b>{currentStep.instruction}</b>
                </div>
              )}

              {nav.liveAnnouncementText && (
                <div className="announcement-box">{nav.liveAnnouncementText}</div>
              )}

              <h3>{copy.directions}</h3>
              <ol className="steps">
                {nav.route.steps.map((step, idx) => (
                  <li
                    key={idx}
                    className={idx === nav.activeStepIndex && nav.navState !== 'idle' ? 'current-step' : ''}
                  >
                    <span>{idx + 1}</span>
                    <div>
                      {step.instruction}
                      <small>{step.distance_m} m</small>
                    </div>
                  </li>
                ))}
              </ol>

              <button
                type="button"
                className="secondary-button"
                onClick={nav.speakCurrentOrAllDirections}
              >
                <Volume2 size={17} />
                {copy.speak}
              </button>
            </>
          )}

          <p className="disclaimer">{copy.note}</p>
        </aside>

        <section className="fullscreen-map-wrap">
          <Map3DView
            destination={destination}
            places={places}
            landmarks={landmarks}
            route={nav.route}
            startPoint={nav.effectiveStartPoint}
            liveGps={nav.navState === 'navigating' || nav.navState === 'paused' ? nav.gps.coords : null}
            headingDeg={nav.gps.headingDeg}
            followUser={nav.followUser && nav.navState === 'navigating'}
            onToggleFollow={nav.recenterMap}
            lang={lang}
          />
        </section>
      </div>
    </main>
  );
}
