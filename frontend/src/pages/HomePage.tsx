
import { useEffect, useMemo, useState } from 'react';
import {
  Edit3,
  Info,
  MapPin,
  Navigation,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';

import { Place } from '../types/navigation';
import { speakAnnouncement } from '../hooks/useLiveNavigation';

type HomePageProps = {
  places: Place[];
  lang: 'en' | 'hi';
  onSelectDestination: (place: Place) => void;
};

const CAMPUS_CARD_IMAGES = [
  '/images/campus-photo-1.jpeg',
  '/images/campus-photo-2.jpeg',
  '/images/campus-photo-3.jpeg',
  '/images/campus-photo-4.jpeg',
  '/images/campus-photo-5.jpeg',
];

const CUSTOM_NOTES_KEY = 'gbu_custom_building_notes_v1';

export default function HomePage({
  places,
  lang,
  onSelectDestination,
}: HomePageProps) {
  const [query, setQuery] = useState('');
  const [infoPlace, setInfoPlace] = useState<Place | null>(null);
  const [customNotes, setCustomNotes] = useState<Record<string, string[]>>({});
  const [noteInput, setNoteInput] = useState('');
  const [isWriting, setIsWriting] = useState(false);

  // Load saved notes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_NOTES_KEY);

      if (saved) {
        setCustomNotes(JSON.parse(saved));
      }
    } catch {
      // Ignore storage error
    }
  }, []);

  // Save notes in localStorage
  function saveNotesToStorage(next: Record<string, string[]>) {
    setCustomNotes(next);

    try {
      localStorage.setItem(CUSTOM_NOTES_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage error
    }
  }

  // Add a new building note
  function handleAddNote(placeId: string) {
    const trimmed = noteInput.trim();

    if (!trimmed) return;

    const existing = customNotes[placeId] || [];

    const next = {
      ...customNotes,
      [placeId]: [...existing, trimmed],
    };

    saveNotesToStorage(next);
    setNoteInput('');
    setIsWriting(false);
  }

  // Delete a saved note
  function handleDeleteNote(placeId: string, idx: number) {
    const existing = customNotes[placeId] || [];

    const next = {
      ...customNotes,
      [placeId]: existing.filter((_, i) => i !== idx),
    };

    saveNotesToStorage(next);
  }

  // Search and filter campus locations
  const filteredPlaces = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return places;

    return places.filter((p) => {
      const notesJoined = (customNotes[p.id] || []).join(' ');

      const fields = [
        p.name,
        p.name_hi || '',
        p.category,
        p.category_hi || '',
        p.description,
        p.description_hi || '',
        notesJoined,
      ]
        .join(' ')
        .toLowerCase();

      return fields.includes(q);
    });
  }, [places, query, customNotes]);

  // Open information popup
  function openBuildingInfo(place: Place) {
    setInfoPlace(place);
    setIsWriting(false);
    setNoteInput('');
  }

  // Close information popup
  function closeBuildingInfo() {
    setInfoPlace(null);
    setIsWriting(false);
    setNoteInput('');
  }

  // Navigate directly to selected destination
  function handleNavigation(place: Place) {
    setInfoPlace(null);
    onSelectDestination(place);
  }

  // English and Hindi text
  const copy =
    lang === 'hi'
      ? {
          tag: 'गौतम बुद्ध विश्वविद्यालय · कैंपस गाइड',
          title: 'GBU की हर जगह की जानकारी और सीधा रास्ता।',
          subtitle:
            'किसी भी स्थान को चुनकर सीधे नेविगेशन शुरू करें या जानकारी बटन से उसकी पूरी जानकारी देखें।',
          searchPlaceholder:
            'बिल्डिंग या विभाग खोजें (जैसे ICT, Management, Gate 1)…',
          placesLabel: 'स्थान',
          privacyNote:
            'किसी स्थान पर क्लिक करके सीधे रास्ता देखें। जानकारी के लिए ⓘ बटन दबाएँ।',
          quickEyebrow: 'कैंपस के प्रमुख स्थान',
          quickTitle: 'अपना गंतव्य चुनें',
          noMatch: 'इस खोज से मेल खाने वाला कोई स्थान नहीं मिला।',
          listenInfo: 'आवाज़ में सुनें',
          openMapTitle: 'नेविगेशन शुरू करें',
          infoTitle: 'बिल्डिंग की जानकारी',
          writeBtn: 'जानकारी लिखें / जोड़ें',
          writePlaceholder:
            'इस बिल्डिंग के बारे में नई जानकारी, रूम नंबर, ऑफिस या नोट लिखें…',
          saveNote: 'सेव करें',
          cancel: 'रद्द करें',
          addedNotesTitle: 'जोड़ी गई अतिरिक्त जानकारी',
          infoButton: 'जानकारी देखें',
        }
      : {
          tag: 'GAUTAM BUDDHA UNIVERSITY · CAMPUS GUIDE',
          title: 'Explore GBU & discover every building.',
          subtitle:
            'Select any campus destination to start navigation, or use the info button to read, listen, or add details.',
          searchPlaceholder:
            'Search building or department (e.g., ICT, Management, Gate 1)…',
          placesLabel: 'PLACES',
          privacyNote:
            'Click a destination to start navigation. Use the info button to view details.',
          quickEyebrow: 'CAMPUS DESTINATIONS',
          quickTitle: 'Choose your destination',
          noMatch: 'No campus location matches your search.',
          listenInfo: 'Listen info',
          openMapTitle: 'Start navigation',
          infoTitle: 'Building Information',
          writeBtn: 'Write / Add info',
          writePlaceholder:
            'Write details, offices, labs, floor info, or notes about this building…',
          saveNote: 'Save',
          cancel: 'Cancel',
          addedNotesTitle: 'Added Information & Notes',
          infoButton: 'View information',
        };

  const activeInfoIndex = infoPlace
    ? Math.max(0, places.findIndex((p) => p.id === infoPlace.id))
    : 0;

  const activePlaceNotes = infoPlace
    ? customNotes[infoPlace.id] || []
    : [];

  const activeImage =
    CAMPUS_CARD_IMAGES[activeInfoIndex % CAMPUS_CARD_IMAGES.length];

  return (
    <>
      {/* HERO SECTION */}
      <section className="hero">
        <div className="hero-shade" />

        <div className="hero-content">
          <div className="eyebrow">
            <span />
            {copy.tag}
          </div>

          <h1>{copy.title}</h1>

          <p>{copy.subtitle}</p>

          {/* DESTINATION SEARCH */}
          <div className="search-panel">
            <div className="search-row">
              <Search size={20} />

              <input
                id="gbu-dest-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={copy.searchPlaceholder}
              />

              <span className="search-count">
                {filteredPlaces.length} {copy.placesLabel}
              </span>
            </div>

            <div className="place-options">
              {filteredPlaces.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => handleNavigation(place)}
                >
                  <span className="place-pin">
                    <MapPin size={17} />
                  </span>

                  <span>
                    <b>
                      {lang === 'hi' && place.name_hi
                        ? place.name_hi
                        : place.name}
                    </b>

                    <small>
                      {lang === 'hi' && place.category_hi
                        ? place.category_hi
                        : place.category}
                    </small>
                  </span>

                  <Navigation size={14} />
                </button>
              ))}

              {filteredPlaces.length === 0 && (
                <p className="search-empty">{copy.noMatch}</p>
              )}
            </div>
          </div>

          <div className="hero-foot">
            <ShieldCheck size={15} />
            <span>{copy.privacyNote}</span>
          </div>
        </div>
      </section>

      {/* CAMPUS DESTINATIONS */}
      <section className="quick-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow dark">
              {copy.quickEyebrow}
            </span>

            <h2>{copy.quickTitle}</h2>
          </div>
        </div>

        <div className="destination-grid">
          {places.map((place, idx) => {
            const title =
              lang === 'hi' && place.name_hi
                ? place.name_hi
                : place.name;

            const desc =
              lang === 'hi' && place.description_hi
                ? place.description_hi
                : place.description;

            const image =
              CAMPUS_CARD_IMAGES[idx % CAMPUS_CARD_IMAGES.length];

            return (
              <div
                className="destination-card clean-info-card"
                key={place.id}
                onClick={() => handleNavigation(place)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNavigation(place);
                  }
                }}
                role="button"
                tabIndex={0}
                title={copy.openMapTitle}
              >
                <div
                  className="card-image"
                  style={{
                    backgroundImage: `url('${image}')`,
                  }}
                >
                  <span>0{idx + 1}</span>

                  {/* INFORMATION BUTTON */}
                  <button
                    type="button"
                    className="card-map-mini-sign"
                    title={copy.infoButton}
                    aria-label={`${copy.infoButton}: ${title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openBuildingInfo(place);
                    }}
                  >
                    <Info size={15} />
                  </button>

                  <div className="card-hover-preview">
                    <p>{desc}</p>
                    <span>{copy.openMapTitle}</span>
                  </div>
                </div>

                <div className="card-copy">
                  <small>
                    {(
                      lang === 'hi' && place.category_hi
                        ? place.category_hi
                        : place.category
                    ).toUpperCase()}
                  </small>

                  <b>{title}</b>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* BUILDING INFORMATION POPUP */}
      {infoPlace && (
        <div
          className="place-modal-backdrop"
          onClick={closeBuildingInfo}
        >
          <div
            className="place-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* POPUP IMAGE */}
            <div
              className="place-modal-banner"
              style={{
                backgroundImage: `url('${activeImage}')`,
              }}
            >
              <button
                type="button"
                className="place-modal-close"
                onClick={closeBuildingInfo}
                aria-label="Close"
              >
                <X size={18} />
              </button>

              {/* NAVIGATION BUTTON */}
              <button
                type="button"
                className="modal-map-mini-sign"
                title={copy.openMapTitle}
                aria-label={copy.openMapTitle}
                onClick={() => handleNavigation(infoPlace)}
              >
                <Navigation size={14} />
              </button>
            </div>

            {/* POPUP CONTENT */}
            <div className="place-modal-body">
              <span className="eyebrow dark">
                {(
                  lang === 'hi' && infoPlace.category_hi
                    ? infoPlace.category_hi
                    : infoPlace.category
                ).toUpperCase()}
              </span>

              <h2>
                {lang === 'hi' && infoPlace.name_hi
                  ? infoPlace.name_hi
                  : infoPlace.name}
              </h2>

              <p className="place-modal-desc">
                {lang === 'hi' && infoPlace.description_hi
                  ? infoPlace.description_hi
                  : infoPlace.description}
              </p>

              {/* SAVED NOTES */}
              {activePlaceNotes.length > 0 && (
                <div className="custom-notes-box">
                  <small>{copy.addedNotesTitle}</small>

                  <ul>
                    {activePlaceNotes.map((note, idx) => (
                      <li key={idx}>
                        <span>{note}</span>

                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteNote(infoPlace.id, idx)
                          }
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ADD NOTE FORM */}
              {isWriting && (
                <div className="write-note-form">
                  <textarea
                    rows={3}
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder={copy.writePlaceholder}
                    autoFocus
                  />

                  <div className="write-note-btns">
                    <button
                      type="button"
                      className="save-note-btn"
                      onClick={() => handleAddNote(infoPlace.id)}
                    >
                      <Save size={14} />
                      {copy.saveNote}
                    </button>

                    <button
                      type="button"
                      className="cancel-note-btn"
                      onClick={() => {
                        setIsWriting(false);
                        setNoteInput('');
                      }}
                    >
                      {copy.cancel}
                    </button>
                  </div>
                </div>
              )}

              {/* LISTEN AND WRITE ACTIONS */}
              <div className="place-modal-single-action">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    const baseDesc =
                      lang === 'hi' && infoPlace.description_hi
                        ? infoPlace.description_hi
                        : infoPlace.description;

                    const extra = activePlaceNotes.join('. ');

                    const title =
                      lang === 'hi' && infoPlace.name_hi
                        ? infoPlace.name_hi
                        : infoPlace.name;

                    const speech = extra
                      ? `${title}. ${baseDesc}. ${extra}`
                      : `${title}. ${baseDesc}`;

                    speakAnnouncement(speech, lang);
                  }}
                >
                  <Volume2 size={16} />
                  {copy.listenInfo}
                </button>

                {!isWriting && (
                  <button
                    type="button"
                    className="write-trigger-btn"
                    onClick={() => setIsWriting(true)}
                  >
                    <Edit3 size={15} />
                    {copy.writeBtn}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
