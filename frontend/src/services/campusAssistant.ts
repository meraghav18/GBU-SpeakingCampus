// Rule-based campus assistant: answers only from approved place data (blueprint: "Campus Assistant
// finds answers from approved node information"). No network, works offline.
// ponytail: keyword retrieval, swap answer() for an LLM call grounded on the same places if free-form chat is needed.
import type { Place } from '../types/navigation';

export type Lang = 'en' | 'hi';
export type Reply = { text: string; places: Place[] };

const GATE: [number, number] = [28.416559, 77.517199];

const STOP = new Set([
  'school', 'of', 'the', 'and', 'gbu', 'boys', 'girls', 'hostel', 'dept', 'block', 'centre',
  'center', 'main', 'no', 'dr', 'shree', 'sant', 'sri', 'studies', 'applied', 'sciences',
]);

const CATEGORY_WORDS: [string, RegExp][] = [
  ['Hostel', /\bhostels?\b|हॉस्टल|छात्रावास/],
  ['Academic', /\bschools?\b|\bdepartments?\b|\bfaculty\b|\bcourses?\b|स्कूल|विभाग/],
  ['Food', /\bfood\b|\beat\b|\bmess\b|\bcanteen\b|\bcafe\b|\bkhana\b|खाना|भोजन|कैंटीन/],
  ['Sports', /\bsports?\b|\bground\b|\bstadium\b|\bplay\b|खेल|मैदान/],
  ['Services', /\bbank\b|\batm\b|\bshops?\b|\bpost\b|बैंक|दुकान/],
  ['Health', /\bhospital\b|\bdoctor\b|\bdispensary\b|\bmedical\b|अस्पताल|डॉक्टर/],
  ['Landmark', /\blandmarks?\b|\bstatues?\b|\blake\b|प्रतिमा|झील/],
  ['Entrance', /\bgates\b|गेट्स/],
];

const DIRECTION_RE = /\bhow\b|\breach\b|\broute\b|\bway\b|\bgo\b|\bwhere\b|\brasta\b|\bkaise\b|\bkahan\b|\bkidhar\b|कहाँ|कहां|कैसे|रास्ता|जाना|किधर/;
const GREET_RE = /^(hi+|hello|hey|namaste|namaskar|good (morning|evening|afternoon))\b|नमस्ते|नमस्कार|हेलो/;
const HELP_RE = /\bhelp\b|what can you|kya kar sakte|मदद/;
const UNMAPPED_RE = /humanities|social science|buddhist|buddhism|मानविकी|बौद्ध/;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metersBetween(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const x =
    Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function scorePlace(q: string, p: Place): number {
  const padded = ` ${q} `;
  let best = 0;
  for (const raw of [p.name, p.name_hi || '', ...(p.aliases || [])]) {
    const t = normalize(raw);
    if (t && padded.includes(` ${t} `)) best = Math.max(best, 10 + t.length);
  }
  const tokens = normalize(p.name)
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w));
  const hits = tokens.filter((w) => padded.includes(` ${w} `)).length;
  if (hits) best = Math.max(best, hits * 4 + (hits === tokens.length ? 3 : 0));
  return best;
}

const name = (p: Place, lang: Lang) => (lang === 'hi' && p.name_hi ? p.name_hi : p.name);
const desc = (p: Place, lang: Lang) =>
  lang === 'hi' && p.description_hi ? p.description_hi : p.description;

export function answer(input: string, places: Place[], lang: Lang): Reply {
  const q = normalize(input);
  const hi = lang === 'hi';
  if (!q) return { text: hi ? 'कुछ लिखिए या बोलिए।' : 'Type or say something.', places: [] };

  const ranked = places
    .map((p) => ({ p, s: scorePlace(q, p) }))
    .filter((r) => r.s >= 4)
    .sort((a, b) => b.s - a.s);
  const top = ranked[0];

  if (UNMAPPED_RE.test(q) && (!top || top.s < 12)) {
    const admin = places.filter((p) => p.id === 'B002');
    return {
      text: hi
        ? 'GBU में यह स्कूल है, पर इसकी बिल्डिंग की सटीक लोकेशन अभी हमारे मैप में सत्यापित नहीं है। जानकारी के लिए प्रशासनिक भवन (एडमिन ब्लॉक) से संपर्क करें।'
        : "This school exists at GBU, but its exact building location isn't verified on our map yet. Ask at the Administrative Block for directions.",
      places: admin,
    };
  }

  if (/\bacres?\b|\barea\b|\bhow big\b|कितना बड़ा|एकड़/.test(q)) {
    return {
      text: hi
        ? 'गौतम बुद्ध विश्वविद्यालय का कैंपस लगभग 511 एकड़ में फैला है, यमुना एक्सप्रेसवे, ग्रेटर नोएडा पर।'
        : 'The GBU campus covers about 511 acres on the Yamuna Expressway, Greater Noida.',
      places: [],
    };
  }

  if (/\btimings?\b|\bopen\b|\bclose\b|\bhours\b|समय|खुल/.test(q) && (!top || top.s < 12)) {
    return {
      text: hi
        ? 'खुलने/बंद होने का समय अभी सत्यापित नहीं है। कृपया संबंधित कार्यालय से पुष्टि करें।'
        : "Opening hours aren't verified yet. Please confirm with the office concerned.",
      places: [],
    };
  }

  const category = CATEGORY_WORDS.find(([, re]) => re.test(q))?.[0];
  if (category && (!top || top.s < 12)) {
    let list = places.filter((p) => p.category === category);
    if (category === 'Hostel' && /\bgirls?\b|\bladies\b|गर्ल्स|लड़कियों/.test(q)) {
      list = list.filter((p) => /girl/i.test(p.name));
    } else if (category === 'Hostel' && /\bboys?\b|बॉयज़|लड़कों/.test(q)) {
      list = list.filter((p) => /boy/i.test(p.name));
    }
    if (list.length) {
      return {
        text: hi
          ? `कैंपस में ये ${list.length} स्थान मिले। किसी पर टैप करके रास्ता देखें:`
          : `Found ${list.length} places on campus. Tap one for directions:`,
        places: list,
      };
    }
  }

  if (top) {
    const p = top.p;
    const fromGate = Math.round(metersBetween(GATE, [p.latitude, p.longitude]) / 10) * 10;
    const wantsWay = DIRECTION_RE.test(q);
    const lines = [
      `${name(p, lang)} — ${desc(p, lang)}`,
      p.id === 'B001'
        ? ''
        : hi
        ? `गेट नं. 1 से सीधी दूरी लगभग ${fromGate} मीटर।`
        : `About ${fromGate} m straight-line from Gate No. 1.`,
      wantsWay
        ? hi
          ? 'नीचे टैप करें — आपकी लोकेशन से पैदल रास्ता और आवाज़ में दिशा-निर्देश मिलेंगे।'
          : 'Tap below for a walking route from your location with spoken directions.'
        : '',
    ].filter(Boolean);
    const alsoClose = ranked.filter((r) => r.p.id !== p.id && r.s >= top.s - 2).slice(0, 2);
    return { text: lines.join('\n'), places: [p, ...alsoClose.map((r) => r.p)] };
  }

  if (GREET_RE.test(q) || HELP_RE.test(q)) {
    return {
      text: hi
        ? 'नमस्ते! मैं GBU कैंपस गाइड हूँ। किसी भी बिल्डिंग, स्कूल, हॉस्टल, लाइब्रेरी या खाने की जगह के बारे में पूछें — जैसे "लाइब्रेरी कहाँ है?" या "ICT कैसे जाएँ?"'
        : 'Hi! I am the GBU campus guide. Ask about any building, school, hostel, library or food spot — e.g. "Where is the library?" or "How do I reach ICT?"',
      places: [],
    };
  }

  return {
    text: hi
      ? 'माफ़ कीजिए, यह जगह नहीं मिली। "हॉस्टल", "स्कूल", "खाना" या किसी बिल्डिंग का नाम लिखकर देखें।'
      : 'Sorry, I could not find that. Try "hostels", "schools", "food" or a building name.',
    places: [],
  };
}
