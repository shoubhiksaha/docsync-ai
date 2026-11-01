/**
 * Search for the home page's app picker. Kept apart from the component so the server can build each
 * app's search text and the matching can be unit-tested.
 */

/**
 * Words people actually type for each document type that its title and description don't contain:
 * Roman Hindi, trade words and common misspellings. Purely for search; never shown.
 */
const KEYWORDS: Record<string, string[]> = {
  'kirana-khata': ['khata', 'khaata', 'udhar', 'udhaar', 'udhari', 'baki', 'baaki', 'grocery', 'ledger', 'credit', 'उधार', 'बकाया', 'बही'],
  'medical-prescription': ['dawai', 'dawa', 'davai', 'dava', 'medicine', 'chemist', 'pharmacy', 'parcha', 'perscription', 'prescripton', 'दवा', 'दवाई', 'केमिस्ट'],
  'garage-repair-estimate': ['gaadi', 'gadi', 'mechanic', 'mistri', 'car', 'bike', 'service', 'quotation', 'मैकेनिक', 'मिस्त्री', 'गाड़ी', 'सर्विस'],
  'mobile-repair-job-card': ['phone', 'fone', 'mobail', 'imei', 'screen', 'फ़ोन', 'मोबाईल'],
  'tailoring-measurement': ['darzi', 'darji', 'tailor', 'silai', 'naap', 'boutique', 'दर्जी', 'सिलाई', 'टेलर'],
  'decorator-challan': ['tent', 'tentwala', 'shamiana', 'decoration', 'shadi', 'wedding', 'टेंट', 'शामियाना', 'सजावट', 'शादी'],
  'mandi-auction-slip': ['arhat', 'aadhat', 'arhatiya', 'boli', 'kisan', 'farmer', 'crop', 'anaj', 'आढ़त', 'आढ़ती', 'बोली', 'किसान', 'अनाज', 'फ़सल'],
  'dairy-collection-slip': ['doodh', 'dudh', 'dhudh', 'milk', 'fat', 'snf', 'litre', 'liter', 'deri', 'दूध', 'डेरी', 'फैट'],
  'pesticide-bill': ['khad', 'khaad', 'beej', 'bij', 'fertilizer', 'fertiliser', 'urea', 'dap', 'seed', 'spray', 'keetnashak', 'खाद', 'बीज', 'यूरिया', 'कीटनाशक'],
  'fish-auction-chit': ['machhli', 'machli', 'machhi', 'boat', 'nilami', 'neelami', 'मछली', 'नाव'],
  'caterer-material-bill': ['catering', 'halwai', 'bhandara', 'samaan', 'saman', 'हलवाई', 'भंडारा', 'सामान'],
  'fleet-fuel-expense': ['petrol', 'diesel', 'deezal', 'cng', 'pump', 'toll', 'driver', 'kharcha', 'kharch', 'gaadi', 'पेट्रोल', 'डीज़ल', 'डीजल', 'टोल', 'खर्चा'],
  'lorry-receipt': ['bilty', 'bilti', 'builty', 'gr', 'truck', 'consignment', 'freight', 'bhada', 'bhaada', 'eway', 'ट्रक', 'भाड़ा'],
  'courier-run-sheet': ['parcel', 'cod', 'rider', 'delivery', 'पार्सल'],
  'godown-storage-receipt': ['warehouse', 'cold', 'storage', 'bori', 'katta', 'bags', 'भंडार', 'बोरी', 'कोल्ड'],
  'factory-weight-slip': ['kanta', 'dharamkanta', 'weighbridge', 'taul', 'tol', 'wajan', 'vajan', 'weight', 'tare', 'gross', 'कांटा', 'धर्मकांटा', 'वज़न'],
  'construction-material-inward': ['cement', 'sand', 'ret', 'balu', 'gitti', 'sariya', 'rod', 'site', 'maal', 'सीमेंट', 'रेत', 'बालू', 'गिट्टी', 'सरिया'],
  'brick-kiln-token': ['eent', 'int', 'bhatta', 'brick', 'kiln', 'ईंट', 'भट्टा'],
  'scrap-dealer-receipt': ['kabadi', 'kabaadi', 'kabad', 'raddi', 'loha', 'scrap', 'कबाड़', 'रद्दी', 'लोहा'],
  'timber-measurement-slip': ['lakdi', 'lakri', 'wood', 'sawmill', 'aara', 'cft', 'लकड़ी', 'आरा'],
  'muster-roll': ['hajiri', 'haziri', 'hajri', 'attendance', 'attendence', 'attendace', 'majdoori', 'mazdoori', 'labour', 'labor', 'wages', 'हाजिरी', 'मजदूरी', 'लेबर'],
  'handloom-weaver-log': ['bunkar', 'kargha', 'karga', 'saree', 'sari', 'yarn', 'dhaga', 'बुनकर', 'करघा', 'साड़ी', 'धागा'],
  'jewelry-karigar-log': ['sona', 'gold', 'chandi', 'silver', 'jewellery', 'jewelery', 'jewellers', 'sunar', 'zevar', 'jewar', 'gahna', 'gehna', 'सोना', 'चाँदी', 'ज़ेवर', 'जेवर', 'सुनार'],
  'handicraft-piece-rate': ['craft', 'artisan', 'nag', 'dastkar', 'karigar', 'हस्तशिल्प', 'दस्तकार'],
  'ngo-receipt': ['daan', 'dan', 'donation', 'chanda', 'trust', '80g', 'दान', 'चंदा', 'ट्रस्ट'],
  'cable-wifi-receipt': ['dish', 'tv', 'wifi', 'internet', 'broadband', 'recharge', 'इंटरनेट', 'डिश'],
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

/** Text to search for one app: its titles and descriptions (both languages) plus keywords. */
export function searchTextFor(id: string, texts: string[]): string {
  const joined = texts.join(' ');
  const roman = ROMAN.filter(([hindi]) => hindi.test(joined)).flatMap(([, spellings]) => spellings);
  return [joined, ...(KEYWORDS[id] ?? []), ...roman].join(' ').toLowerCase();
}

/**
 * Lower-case, accents and the Hindi nukta removed, so "वजन" finds "वज़न" and "cafe" finds "café".
 * Long and short Hindi vowels, chandrabindu and anusvara are folded too: people spell
 * "मोबाईल"/"मोबाइल" and "पर्चियाँ"/"पर्चियां" either way.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-़ͯ]/g, '')
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

/** A Hindi word without its ending, so the singular finds the plural and back. Leaves two letters at least. */
function stem(word: string): string {
  const ending = HINDI_ENDINGS.find(e => word.endsWith(e) && word.length - e.length >= 2);
  return ending ? word.slice(0, -ending.length) : word;
}

/** Words of normalized text: letters (with Hindi vowel signs) and digits, split at everything else. */
export function words(text: string): string[] {
  return normalize(text).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean).map(stem);
}

/** Each typed word must start a word of the app's text, so "LR" finds lorry receipts, not "jewelry". */
export function matches(own: string[], typed: string[]): boolean {
  return typed.every(w => own.some(o => o.startsWith(w)));
}
