// Run: node src/services/campusAssistant.check.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { answer } from './campusAssistant.ts';

const places = JSON.parse(readFileSync(new URL('../data/campusLocations.json', import.meta.url), 'utf8'));
const top = (q: string, lang: 'en' | 'hi' = 'en') => answer(q, places, lang).places[0]?.id;

assert.equal(top('Where is the library?'), 'B012');
assert.equal(top('how to reach ICT'), 'B005');
assert.equal(top('law school'), 'B011');
assert.equal(top('kabir hostel'), 'B030');
assert.equal(top('लाइब्रेरी कहाँ है', 'hi'), 'B012');
assert.ok(answer('hostels', places, 'en').places.length >= 10);
assert.ok(answer('girls hostel', places, 'en').places.every((p: { name: string }) => /girl/i.test(p.name)));
assert.equal(top('school of humanities'), 'B002'); // unmapped -> Admin Block
assert.equal(answer('hello', places, 'en').places.length, 0);
assert.equal(answer('xyzzy', places, 'en').places.length, 0);
console.log('campusAssistant: all checks passed');
