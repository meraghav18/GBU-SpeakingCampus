// Google-Maps-style colour + glyph per place category (keys match Place.category).
export type CategoryMeta = { color: string; glyph: string; en: string; hi: string };

export const CATEGORY_META: Record<string, CategoryMeta> = {
  Academic: { color: '#1a73e8', glyph: '🎓', en: 'Schools', hi: 'स्कूल' },
  Hostel: { color: '#c2185b', glyph: '🛏️', en: 'Hostels', hi: 'हॉस्टल' },
  Food: { color: '#f57c00', glyph: '🍴', en: 'Food', hi: 'खाना' },
  Library: { color: '#00897b', glyph: '📚', en: 'Library', hi: 'पुस्तकालय' },
  Administration: { color: '#5e35b1', glyph: '🏛️', en: 'Admin', hi: 'प्रशासन' },
  Sports: { color: '#0f9d58', glyph: '🏏', en: 'Sports', hi: 'खेल' },
  Events: { color: '#8e24aa', glyph: '🎤', en: 'Events', hi: 'कार्यक्रम' },
  Landmark: { color: '#6d4c41', glyph: '📍', en: 'Landmarks', hi: 'स्थल' },
  Meditation: { color: '#7b1fa2', glyph: '🧘', en: 'Meditation', hi: 'ध्यान' },
  Health: { color: '#d93025', glyph: '🏥', en: 'Health', hi: 'स्वास्थ्य' },
  Services: { color: '#546e7a', glyph: '🏪', en: 'Services', hi: 'सुविधाएँ' },
  Entrance: { color: '#3c4043', glyph: '🚪', en: 'Gates', hi: 'गेट' },
};

export const FALLBACK_META: CategoryMeta = { color: '#5f6368', glyph: '•', en: 'Other', hi: 'अन्य' };

export const metaFor = (category: string): CategoryMeta =>
  CATEGORY_META[category] || FALLBACK_META;
