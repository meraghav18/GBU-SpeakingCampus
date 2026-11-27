import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Mic, Navigation, Send, Volume2, VolumeX, X } from 'lucide-react';
import type { Place } from '../types/navigation';
import { answer, Lang } from '../services/campusAssistant';
import { speakAnnouncement } from '../hooks/useLiveNavigation';
import { metaFor } from '../data/categories';

type Msg = { from: 'bot' | 'user'; text: string; places?: Place[] };

type Props = {
  places: Place[];
  lang: Lang;
  onNavigate: (place: Place) => void;
};

// Web Speech API recognition is not in TS DOM lib yet.
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => Recognition) | null;
}

export default function CampusChat({ places, lang, onNavigate }: Props) {
  const hi = lang === 'hi';
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [speak, setSpeak] = useState(true);
  const [listening, setListening] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const RecognitionCtor = getRecognitionCtor();

  const suggestions = hi
    ? ['लाइब्रेरी कहाँ है?', 'हॉस्टल', 'ICT कैसे जाएँ?', 'खाना', 'स्कूल']
    : ['Where is the library?', 'Hostels', 'How to reach ICT?', 'Food', 'Schools'];

  useEffect(() => {
    setMessages([
      {
        from: 'bot',
        text: hi
          ? 'नमस्ते! मैं GBU कैंपस गाइड हूँ। कोई भी जगह पूछें — लिखकर या 🎤 से बोलकर।'
          : 'Hi! I am the GBU campus guide. Ask about any place — type or tap 🎤 to speak.',
      },
    ]);
  }, [hi]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => () => recRef.current?.stop(), []);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const reply = answer(trimmed, places, lang);
    setMessages((prev) => [
      ...prev,
      { from: 'user', text: trimmed },
      { from: 'bot', text: reply.text, places: reply.places },
    ]);
    setInput('');
    if (speak) speakAnnouncement(reply.text, lang);
  }

  function toggleMic() {
    if (!RecognitionCtor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new RecognitionCtor();
    rec.lang = hi ? 'hi-IN' : 'en-IN';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript || '';
      send(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  if (!open) {
    return (
      <button type="button" className="chat-fab" onClick={() => setOpen(true)} aria-label="Open campus assistant">
        <MessageCircle size={22} />
        <span>{hi ? 'कैंपस से पूछें' : 'Ask Campus'}</span>
      </button>
    );
  }

  return (
    <section className="chat-panel" aria-label="Campus assistant">
      <header className="chat-head">
        <div>
          <b>{hi ? 'GBU कैंपस गाइड' : 'GBU Campus Guide'}</b>
          <small>{hi ? 'बोलें या लिखें · हिंदी / English' : 'Speak or type · English / हिंदी'}</small>
        </div>
        <div className="chat-head-actions">
          <button
            type="button"
            onClick={() => {
              if (speak) window.speechSynthesis?.cancel();
              setSpeak(!speak);
            }}
            aria-label={speak ? 'Mute voice replies' : 'Unmute voice replies'}
            title={speak ? 'Mute' : 'Unmute'}
          >
            {speak ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="chat-body" ref={bodyRef} aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.from}`}>
            {m.text}
            {m.places && m.places.length > 0 && (
              <div className="chat-place-list">
                {m.places.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onNavigate(p);
                      setOpen(false);
                    }}
                  >
                    <span>
                      {metaFor(p.category).glyph}&nbsp; {hi && p.name_hi ? p.name_hi : p.name}
                    </span>
                    <Navigation size={13} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="chat-suggestions">
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={hi ? 'कोई जगह पूछें…' : 'Ask about a place…'}
          aria-label={hi ? 'संदेश' : 'Message'}
        />
        <button
          type="button"
          className={listening ? 'listening' : ''}
          onClick={toggleMic}
          disabled={!RecognitionCtor}
          aria-label={listening ? 'Stop listening' : 'Speak'}
          title={RecognitionCtor ? '' : 'Voice input not supported in this browser'}
        >
          <Mic size={18} />
        </button>
        <button type="submit" aria-label="Send">
          <Send size={17} />
        </button>
      </form>
    </section>
  );
}
