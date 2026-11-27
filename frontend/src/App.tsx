import { useEffect, useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import {
  fetchLandmarks,
  fetchVerifiedLocations,
  getCentralFallbackPlaces,
} from './services/api';
import { Landmark, Place } from './types/navigation';
import HomePage from './pages/HomePage';
import NavigationPage from './pages/NavigationPage';
import CampusChat from './components/CampusChat';

function getDestinationIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/navigation\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const [places, setPlaces] = useState<Place[]>(() => getCentralFallbackPlaces());
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [backendBanner, setBackendBanner] = useState<string>('');
  const [pathname, setPathname] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );

  useEffect(() => {
    const handlePopState = () => {
      setPathname(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let active = true;
    fetchVerifiedLocations().then(({ places: loaded, fromBackend }) => {
      if (!active) return;
      setPlaces(loaded);
      if (!fromBackend) {
        setBackendBanner(
          lang === 'hi'
            ? 'बैकएंड सर्वर से संपर्क नहीं हो सका — सत्यापित स्थानीय डेटासेट दिखाया जा रहा है।'
            : 'Backend API unreachable — displaying verified local campus dataset.'
        );
      } else {
        setBackendBanner('');
      }
    });

    fetchLandmarks().then((lm) => {
      if (active) setLandmarks(lm);
    });

    return () => {
      active = false;
    };
  }, [lang]);

  const activeDestinationId = useMemo(
    () => getDestinationIdFromPath(pathname),
    [pathname]
  );

  const selectedDestination = useMemo(() => {
    if (!activeDestinationId) return null;
    return (
      places.find(
        (p) => p.id.toLowerCase() === activeDestinationId.toLowerCase()
      ) || places[0] || null
    );
  }, [activeDestinationId, places]);

  function navigateToDestination(place: Place) {
    const targetPath = `/navigation/${encodeURIComponent(place.id)}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ destinationId: place.id }, '', targetPath);
      setPathname(targetPath);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function navigateToHome() {
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
      setPathname('/');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="app">
      <header className="nav">
        <button
          type="button"
          className="brand brand-btn"
          onClick={navigateToHome}
        >
          <div className="brand-mark">SC</div>
          <div>
            <b>
             Speaking Campus
            </b>
            <small>GAUTAM BUDDHA UNIVERSITY</small>
          </div>
        </button>

        <div className="nav-right">
  <span className="nav-status">
    <i /> {lang === 'hi' ? 'स्पीकिंग कैंपस' : 'SPEAKING CAMPUS'}
  </span>

  <button
            type="button"
            className="lang"
            onClick={() => setLang((prev) => (prev === 'en' ? 'hi' : 'en'))}
          >
            <Globe size={16} />
            {lang === 'en' ? 'EN | हिंदी' : 'हिंदी | EN'}
          </button>
        </div>
      </header>

      {backendBanner && <div className="api-notice-bar">{backendBanner}</div>}

      {selectedDestination ? (
        <NavigationPage
          key={selectedDestination.id}
          destination={selectedDestination}
          places={places}
          landmarks={landmarks}
          lang={lang}
          onBackHome={navigateToHome}
          onChangeDestination={navigateToDestination}
        />
      ) : (
        <HomePage
          places={places}
          lang={lang}
          onSelectDestination={navigateToDestination}
        />
      )}

      <CampusChat places={places} lang={lang} onNavigate={navigateToDestination} />

      <footer>
        <div className="brand">
          <div className="brand-mark">SC</div>
          <div>
            <b>
              Speaking Campus
            </b>
            <small>GAUTAM BUDDHA UNIVERSITY</small>
          </div>
        </div>

        <span>
          {lang === 'hi'
            ? 'गौतम बुद्ध विश्वविद्यालय के आसान पैदल नेविगेशन के लिए निर्मित।'
            : 'Built for easier campus discovery & live navigation.'}
        </span>
        <span>GAUTAM BUDDHA UNIVERSITY · GREATER NOIDA</span>
      </footer>
    </div>
  );
}