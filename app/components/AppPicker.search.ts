/**
 * Search for the home page's app picker. Kept apart from the component so the server can build each
 * app's search text and the matching can be unit-tested.
 */

/**
 * Words people actually type for each document type that its title and description don't contain:
 * Roman Hindi, trade words and common misspellings. Purely for search; never shown.
 */
const KEYWORDS: Record<string, string[]> = {
  'kirana-khata': ['khata', 'khaata', 'kiraana', 'dukan', 'dukaan', 'udhar', 'udhaar', 'udhari', 'baki', 'baaki', 'grocery', 'ledger', 'credit', 'hisab', 'hisaab', 'उधार', 'बकाया', 'बही', 'हिसाब'],
  'medical-prescription': ['dawai', 'dawa', 'davai', 'dava', 'medicine', 'chemist', 'pharmacy', 'parcha', 'perscription', 'prescripton', 'दवा', 'दवाई', 'केमिस्ट'],
  'garage-repair-estimate': ['gaadi', 'gadi', 'mechanic', 'mistri', 'car', 'bike', 'service', 'quotation', 'invoice', 'मैकेनिक', 'मिस्त्री', 'गाड़ी', 'सर्विस'],
  'mobile-repair-job-card': ['phone', 'fone', 'mobail', 'imei', 'screen', 'फ़ोन', 'मोबाईल'],
  'tailoring-measurement': ['darzi', 'darji', 'tailor', 'silai', 'naap', 'boutique', 'kapda', 'kapde', 'kapra', 'दर्जी', 'सिलाई', 'टेलर', 'कपड़ा'],
  'decorator-challan': ['tent', 'tentwala', 'shamiana', 'decoration', 'shadi', 'wedding', 'house', 'टेंट', 'हाउस', 'शामियाना', 'सजावट', 'शादी'],
  'mandi-auction-slip': [
    'arhat', 'aadhat', 'arhatiya', 'adhtiya', 'boli', 'kisan', 'farmer', 'crop', 'anaj', 'sabzi', 'sabji', 'subzi', 'phal', 'fruit',
    'आढ़त', 'आढ़ती', 'आढ़तिया', 'बोली', 'किसान', 'अनाज', 'फ़सल', 'सब्ज़ी', 'सब्जी', 'फल',
  ],
  'dairy-collection-slip': ['doodh', 'dudh', 'dhudh', 'milk', 'fat', 'snf', 'litre', 'liter', 'deri', 'diary', 'दूध', 'डेरी', 'फैट'],
  'pesticide-bill': ['khad', 'khaad', 'beej', 'bij', 'fertilizer', 'fertiliser', 'urea', 'dap', 'seed', 'spray', 'keetnashak', 'invoice', 'खाद', 'बीज', 'यूरिया', 'कीटनाशक'],
  'fish-auction-chit': ['machhli', 'machli', 'machhi', 'boat', 'nilami', 'neelami', 'मछली', 'नाव'],
  'caterer-material-bill': ['catering', 'halwai', 'bhandara', 'samaan', 'saman', 'invoice', 'sabji', 'sabzi', 'हलवाई', 'भंडारा', 'सामान', 'सब्ज़ी'],
  'fleet-fuel-expense': ['petrol', 'diesel', 'deezal', 'cng', 'pump', 'toll', 'driver', 'kharcha', 'kharch', 'gaadi', 'पेट्रोल', 'डीज़ल', 'डीजल', 'पंप', 'पम्प', 'टोल', 'खर्चा'],
  'lorry-receipt': ['bilty', 'bilti', 'builty', 'gr', 'truck', 'consignment', 'freight', 'bhada', 'bhaada', 'eway', 'बिलटी', 'ट्रक', 'भाड़ा'],
  'courier-run-sheet': ['parcel', 'cod', 'rider', 'delivery', 'पार्सल'],
  'godown-storage-receipt': ['warehouse', 'cold', 'storage', 'bori', 'katta', 'bags', 'भंडार', 'बोरी', 'कोल्ड'],
  'factory-weight-slip': ['kanta', 'dharamkanta', 'weighbridge', 'taul', 'tol', 'wajan', 'vajan', 'weight', 'tare', 'gross', 'कांटा', 'धर्मकांटा', 'धरम', 'धरमकांटा', 'वज़न'],
  'construction-material-inward': ['cement', 'sand', 'ret', 'balu', 'gitti', 'sariya', 'rod', 'site', 'maal', 'सीमेंट', 'रेत', 'बालू', 'गिट्टी', 'सरिया'],
  'brick-kiln-token': ['eent', 'int', 'bhatta', 'brick', 'kiln', 'ईंट', 'भट्टा'],
  'scrap-dealer-receipt': ['kabadi', 'kabaadi', 'kabad', 'raddi', 'loha', 'scrap', 'कबाड़', 'स्क्रैप', 'रद्दी', 'लोहा'],
  'timber-measurement-slip': ['lakdi', 'lakri', 'wood', 'sawmill', 'aara', 'cft', 'लकड़ी', 'आरा'],
  'muster-roll': [
    'hajiri', 'haziri', 'hajri', 'attendance', 'attendence', 'attendace', 'majdoori', 'mazdoori', 'mazdur', 'majdur', 'mazdoor', 'majdoor',
    'labour', 'labor', 'wages', 'salary', 'tankhwah', 'tankha', 'मस्टर', 'रोल', 'हाजिरी', 'हाजरी', 'मजदूरी', 'मज़दूर', 'लेबर', 'तनख्वाह', 'वेतन',
  ],
  'handloom-weaver-log': ['bunkar', 'kargha', 'karga', 'saree', 'sari', 'yarn', 'dhaga', 'kapda', 'kapde', 'kapra', 'बुनकर', 'करघा', 'साड़ी', 'धागा', 'कपड़ा'],
  'jewelry-karigar-log': ['sona', 'gold', 'chandi', 'silver', 'jewellery', 'jewelery', 'jewellers', 'sunar', 'zevar', 'jewar', 'gahna', 'gehna', 'सोना', 'चाँदी', 'ज़ेवर', 'जेवर', 'सुनार'],
  'handicraft-piece-rate': ['craft', 'artisan', 'nag', 'dastkar', 'karigar', 'हस्तशिल्प', 'दस्तकार'],
  'ngo-receipt': ['daan', 'dan', 'donation', 'chanda', 'trust', '80g', 'दान', 'चंदा', 'ट्रस्ट'],
  'cable-wifi-receipt': ['dish', 'tv', 'wifi', 'internet', 'broadband', 'recharge', 'वाईफाई', 'वायफाय', 'इंटरनेट', 'डिश'],
  'pds-distribution-log': ['ration', 'rashan', 'kotedar', 'gehu', 'gehun', 'chawal', 'wheat', 'rice', 'राशन', 'गेहूँ', 'चावल', 'कोटेदार'],
  'street-vendor-daily-finance': ['rehdi', 'rehri', 'thela', 'thelewala', 'vendor', 'kist', 'kisht', 'emi', 'loan', 'bachat', 'किस्त', 'ठेला', 'लोन', 'कर्ज़'],
};

/** Roman spellings of document words found in many Hindi titles, added wherever the word starts a word. */
const ROMAN: [RegExp, string[]][] = [
  [/(?:^|[^\p{L}\p{M}])पर्च/u, ['parchi', 'parchee', 'parcha']],
  [/(?:^|[^\p{L}\p{M}])रसीद/u, ['rasid', 'raseed']],
  [/(?:^|[^\p{L}\p{M}])चालान/u, ['challan', 'chalan']],
  [/(?:^|[^\p{L}\p{M}])रजिस्टर/u, ['register']],
  [/(?:^|[^\p{L}\p{M}])हिसाब/u, ['hisab', 'hisaab']],
  [/(?:^|[^\p{L}\p{M}])बिल(?![\p{L}\p{M}])/u, ['bill']],
];

/** One app's search text. A match in its names counts for more than one only in its descriptions. */
export interface SearchText {
  /** Titles, document names and keywords. */
  names: string;
  /** Descriptions, card lines and trade groups ("dairy" lists the dairy slips before the rest of the farm group). */
  text: string;
}

function withRoman(texts: string[], extra: string[] = []): string {
  const joined = texts.join(' ');
  const roman = ROMAN.filter(([hindi]) => hindi.test(joined)).flatMap(([, spellings]) => spellings);
  return [joined, ...extra, ...roman].join(' ').toLowerCase();
}

/** Text to search for one app: names and descriptions (both languages) plus keywords. */
export function searchTextFor(id: string, names: string[], descriptions: string[]): SearchText {
  return { names: withRoman(names, KEYWORDS[id]), text: withRoman(descriptions) };
}

/**
 * Lower-case, accents and the Hindi nukta removed, so "वजन" finds "वज़न" and "cafe" finds "café".
 * Long and short Hindi vowels, chandrabindu and anusvara are folded too: people spell
 * "मोबाईल"/"मोबाइल" and "पर्चियाँ"/"पर्चियां" either way.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u093c]/g, '')
    .toLowerCase()
    .replace(/ी/g, 'ि') // ी → ि
    .replace(/ू/g, 'ु') // ू → ु
    .replace(/ई/g, 'इ') // ई → इ
    .replace(/ऊ/g, 'उ') // ऊ → उ
    .replace(/ॉ/g, 'ा') // ॉ → ा
    .replace(/ऑ/g, 'आ') // ऑ → आ
    .replace(/ँ/g, 'ं'); // ँ → ं
}

// Plural and inflected endings (after normalize), longest first: खाता/खाते/खातों, पर्ची/पर्चियाँ.
const HINDI_ENDINGS = ['ियों', 'ियां', 'ाओं', 'ाएं', 'ों', 'ें', 'ां', 'ा', 'े', 'ि', 'ो'];

// Hindi keywords are whole words: "दर्जी" (tailor) must not shrink to "दर्ज" (record).
const UNSTEMMED = new Set(Object.values(KEYWORDS).flat().filter(word => /\p{Script=Devanagari}/u.test(word)).map(normalize));

/**
 * A word without its plural ending, so the singular finds the plural and back: Hindi endings
 * (leaving two letters at least) and an English "s" ("shops", "bills"; not "gross").
 */
function stem(word: string): string {
  if (UNSTEMMED.has(word)) return word;
  if (/^[a-z]{3,}s$/.test(word) && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  const ending = HINDI_ENDINGS.find(e => word.endsWith(e) && word.length - e.length >= 2);
  return ending ? word.slice(0, -ending.length) : word;
}

/** Words of normalized text: letters (with Hindi vowel signs) and digits, split at everything else. */
export function words(text: string): string[] {
  return normalize(text).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean).map(stem);
}

/** Joining words of a typed phrase ("kirana ka khata", "दूध का हिसाब"); they say nothing about the document. */
const STOP = new Set([
  'ka', 'ki', 'ke', 'ko', 'se', 'aur', 'ya', 'mera', 'meri', 'mere', 'a', 'an', 'and', 'or', 'of', 'for', 'the', 'my', 'in', 'to',
  'का', 'की', 'के', 'को', 'से', 'और', 'या', 'में', 'मेरा', 'मेरी', 'मेरे',
].flatMap(words));

/**
 * Words for a kind of paper or a place rather than a trade. In "medical bill", "doodh ki parchi" or
 * "kapda dukan" they only help the ranking; typed alone ("bill", "dukan") they must match like any word.
 */
const GENERIC = new Set([
  'bill', 'receipt', 'rasid', 'raseed', 'slip', 'parchi', 'parchee', 'chit', 'challan', 'chalan', 'hisab', 'hisaab', 'register', 'book', 'card',
  'dukan', 'dukaan', 'shop', 'बिल', 'रसीद', 'पर्ची', 'चालान', 'हिसाब', 'रजिस्टर', 'दुकान',
].flatMap(words));

/** One app's words, ready to rank. */
export interface SearchIndex {
  names: string[];
  text: string[];
}

export function searchIndex({ names, text }: SearchText): SearchIndex {
  return { names: [...new Set(words(names))], text: [...new Set(words(text))] };
}

// Shorter words with one letter changed are often another real word: "dhaba"/"dhaga", "kiraya"/"kirana".
const CHANGED_LETTER_FROM = 7;

/**
 * True when `a` and `b` differ by one letter added, dropped or two swapped ("diary"/"dairy"), or,
 * in long words, one letter changed.
 */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return (a.length >= CHANGED_LETTER_FROM && a.slice(i + 1) === b.slice(i + 1)) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

// How well one typed word fits one app, best first. 0 is no match.
const NAME_WORD = 4;
const NAME_START = 3;
const TEXT_WORD = 2;
const TEXT_START = 1;

// Letters without Hindi vowel signs: "बिजल" is three letters ("बजल"), too short to allow a typo.
const letters = (word: string) => word.replace(/\p{M}/gu, '').length;
// A short word that only starts a description word is mostly another word: "chai" is not "chairs", "rent" not "rental".
const TEXT_START_FROM = 5;

/**
 * How sure a search is of its best result. `name`: every word names the document type, so the
 * Search key may open a lone match. `text`: every word is a whole word of its description.
 * `closest`: a guess (a typo, the start of a description word, or not every word matched).
 */
export type MatchStrength = 'name' | 'text' | 'closest';

export interface Ranked<T> {
  items: T[];
  match: MatchStrength;
}

/**
 * The typed words worth searching for: no joining words, and no one- or two-letter word unless it
 * is a whole name somewhere ("LR", "TV"). Empty while nothing searchable is typed ("a", "का").
 */
export function searchable<T extends { index: SearchIndex }>(items: T[], typed: string[]): string[] {
  return typed.filter(word => !STOP.has(word) && (word.length > 2 || items.some(({ index }) => index.names.includes(word))));
}

/**
 * The items that match every typed word, best first, and how sure the best match is. Document words like "bill" or "पर्ची" are
 * optional next to a word that names the trade, and when nothing matches every word, the items
 * matching the most words are listed instead ("labour payment"). A typed word must start a word of
 * the item ("LR" finds lorry receipts, not "jewelry"); a word that is a whole name somewhere ("ईंट", "car")
 * only matches whole words, so it doesn't also find "इंटरनेट" or "card". Names rank above
 * descriptions, and description-only partial matches are dropped when a name matches.
 * A word of four letters or more (vowel signs aside) that starts no word at all may have one typo ("reciept"), and
 * only words of five letters or more count when they merely start a description word.
 */
export function rank<T extends { index: SearchIndex }>(items: T[], typed: string[]): Ranked<T> {
  if (typed.length === 0) return { items, match: 'name' };
  const specific = typed.some(word => !GENERIC.has(word));
  const plans = typed.map(word => {
    const whole = items.some(({ index }) => index.names.includes(word));
    const starts = items.some(({ index }) => [...index.names, ...index.text].some(own => own.startsWith(word)));
    return { word, whole, typo: !starts && letters(word) >= 4, optional: specific && GENERIC.has(word) };
  });
  const score = ({ names, text }: SearchIndex, { word, whole, typo }: (typeof plans)[number]): number => {
    if (names.includes(word)) return NAME_WORD;
    if (!whole && names.some(own => own.startsWith(word))) return NAME_START;
    if (text.includes(word)) return TEXT_WORD;
    if (!whole && letters(word) >= TEXT_START_FROM && text.some(own => own.startsWith(word))) return TEXT_START;
    if (typo && names.some(own => oneEdit(own, word))) return TEXT_START;
    return 0;
  };
  const all = items.map((item, order) => {
    const scores = plans.map(plan => score(item.index, plan));
    return {
      item,
      order,
      worst: Math.min(...scores.filter((_, i) => !plans[i].optional)),
      total: scores.reduce((sum, s) => sum + s, 0),
      hits: scores.filter(s => s > 0).length,
      missed: scores.some((s, i) => plans[i].optional && s === 0),
    };
  });
  const scored = all.filter(s => s.worst > 0);
  if (scored.length === 0) {
    const closest = all
      .filter(s => s.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.total - a.total || a.order - b.order)
      .map(s => s.item);
    return { items: closest, match: 'closest' };
  }
  const best = Math.max(...scored.map(s => s.worst));
  const shown = scored.filter(s => best < NAME_START || s.worst >= TEXT_WORD);
  // "light bill": a description word ("lights") on a document that isn't the bill typed is only a guess.
  const match: MatchStrength = best >= NAME_START ? 'name' : shown.some(s => s.worst >= TEXT_WORD && !s.missed) ? 'text' : 'closest';
  return { items: shown.sort((a, b) => b.total - a.total || a.order - b.order).map(s => s.item), match };
}
