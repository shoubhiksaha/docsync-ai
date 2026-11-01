import { en } from '@/client/i18n/en';
import { hi } from '@/client/i18n/hi';
import { translate } from '@/client/i18n';
import type { MessageKey } from '@/client/i18n/en';
import { activeProfiles, localizedProfile } from '@/modules/profiles';
import { rank, searchIndex, searchTextFor, searchable, words } from '@/app/components/AppPicker.search';
import { byOwner, OWNER_KEY, parseRecentApps, parseScanRows, prunable, retryInput, savedScan, type StoredScan } from '@/client/scan-store';

const LANGS = ['en', 'hi'] as const;

// The same search text the home page builds.
const index = activeProfiles().map(p => {
  const texts = LANGS.map(l => localizedProfile(p, l));
  return {
    id: p.id,
    index: searchIndex(searchTextFor(
      p.id,
      texts.flatMap(text => [text.title, text.documentName]),
      [...texts.map(text => text.description), ...LANGS.flatMap(l => [translate(l, `card.${p.id}` as MessageKey), translate(l, `group.${p.group}`)])],
    )),
  };
});
// As AppPicker searches: nothing searchable typed lists nothing as a search.
const ranked = (query: string) => {
  const typed = searchable(index, words(query));
  return typed.length ? rank(index, typed) : { items: [], match: 'closest' as const };
};
const search = (query: string) => ranked(query).items.map(app => app.id);

describe('home page search', () => {
  it('finds something for every example in the search placeholder', () => {
    for (const placeholder of [en['home.searchPlaceholder'], hi['home.searchPlaceholder']]) {
      const examples = placeholder.replace(/^(e\.g\.|जैसे)\s*/, '').split(',').map(s => s.trim());
      expect(examples.length).toBeGreaterThan(1);
      for (const example of examples) expect([example, search(example).length > 0]).toEqual([example, true]);
    }
  });

  it('matches Hindi singular and plural, and long or short vowels', () => {
    expect(search('खाता')).toContain('kirana-khata');
    expect(search('ईंट पर्ची')).toContain('brick-kiln-token');
    expect(search('मोबाईल')).toContain('mobile-repair-job-card');
    expect(search('रसीद')).toContain('ngo-receipt');
  });

  it('knows Roman Hindi, trade words and common misspellings', () => {
    const cases: [string, string][] = [
      ['doodh', 'dairy-collection-slip'], ['dudh parchi', 'dairy-collection-slip'], ['udhar', 'kirana-khata'],
      ['petrol', 'fleet-fuel-expense'], ['diesel', 'fleet-fuel-expense'], ['डीजल', 'fleet-fuel-expense'], ['पेट्रोल', 'fleet-fuel-expense'],
      ['bilty', 'lorry-receipt'], ['hajiri', 'muster-roll'], ['attendence', 'muster-roll'], ['dawai', 'medical-prescription'],
      ['darzi', 'tailoring-measurement'], ['sona', 'jewelry-karigar-log'], ['जेवर', 'jewelry-karigar-log'],
    ];
    for (const [query, id] of cases) expect([query, search(query)]).toEqual([query, expect.arrayContaining([id])]);
  });

  it('still needs each typed word to start a word', () => {
    expect(search('LR')).toEqual(['lorry-receipt']);
    expect(search('zzz')).toEqual([]);
  });

  it('understands everyday phrases: joining words are skipped and "bill" or "parchi" only helps', () => {
    const cases: [string, string][] = [
      ['kirana ka khata', 'kirana-khata'], ['doodh ki parchi', 'dairy-collection-slip'], ['petrol ka bill', 'fleet-fuel-expense'],
      ['gaadi ka bill', 'garage-repair-estimate'], ['medical bill', 'medical-prescription'], ['medicine bill', 'medical-prescription'],
      ['pharmacy bill', 'medical-prescription'], ['milk bill', 'dairy-collection-slip'], ['repair bill', 'garage-repair-estimate'],
      ['garage bill', 'garage-repair-estimate'], ['diesel bill', 'fleet-fuel-expense'], ['kirana bill', 'kirana-khata'],
      ['tent bill', 'decorator-challan'], ['doodh hisab', 'dairy-collection-slip'], ['udhaar ka hisab', 'kirana-khata'],
      ['दूध का हिसाब', 'dairy-collection-slip'], ['sabzi mandi', 'mandi-auction-slip'], ['kapda dukan', 'tailoring-measurement'],
    ];
    for (const [query, id] of cases) expect([query, search(query)[0]]).toEqual([query, id]);
    expect(search('hisab')[0]).toBe('kirana-khata');
    expect(search('हिसाब')[0]).toBe('kirana-khata');
  });

  it('lists the closest matches when no document has every word', () => {
    expect(search('labour payment')[0]).toBe('muster-roll');
    expect(search('hisaab kitab')).toContain('kirana-khata');
    expect(ranked('labour payment').match).toBe('closest');
  });

  it('only calls a match sure when every word names it, so the Search key never opens a guess', () => {
    // School fees and electricity bills have no document type; Cable TV and Decorator only share a word or a word start.
    for (const query of ['school fees', 'light bill', 'chai', 'rent', 'feed', 'reciept', 'kriana']) {
      expect([query, ranked(query).match]).toEqual([query, 'closest']);
    }
    for (const query of ['doodh', 'LR', 'medical bill', 'kirana shop', 'sabzi mandi']) expect([query, ranked(query).match]).toEqual([query, 'name']);
    expect(ranked('vegetables')).toMatchObject({ match: 'text', items: [expect.objectContaining({ id: 'caterer-material-bill' })] });
  });

  it('lists a word that only starts a name, but never opens it: "lab" is not labour, "tank" not tankha', () => {
    const cases: [string, string][] = [['lab', 'muster-roll'], ['tank', 'muster-roll'], ['pet', 'fleet-fuel-expense'], ['dia', 'dairy-collection-slip']];
    for (const [query, id] of cases) expect([query, ranked(query).match, search(query)]).toEqual([query, 'start', [id]]);
    for (const query of ['LR', 'khata', 'doodh']) expect([query, ranked(query).match, search(query).length]).toEqual([query, 'name', 1]);
  });

  it('shows no match for everyday words with no document type, instead of an unrelated app', () => {
    // Tuition fees are not a cable bill; "chai" is not "chairs" and "rent" is not "rental".
    for (const query of ['fees', 'school fees', 'chai', 'rent']) expect([query, search(query)]).toEqual([query, []]);
    expect(search('chairs')).toContain('decorator-challan');
    expect(search('cable')).toContain('cable-wifi-receipt');
  });

  it('allows a typo only in words of four letters or more, not counting Hindi vowel signs', () => {
    // बिजली (electricity) is three letters; with its vowel sign it must not pass for बिल (bill).
    expect(search('बिजली')).toEqual([]);
    expect(search('attendence')).toEqual(['muster-roll']);
  });

  it('ranks the trade above the place: "kapda dukan" is cloth, not the kirana shop', () => {
    expect(search('kapda dukan')).not.toContain('kirana-khata');
    expect(search('dukan')).toContain('kirana-khata');
    expect(search('sabzi mandi')).toEqual(expect.arrayContaining(['mandi-auction-slip', 'caterer-material-bill']));
    expect(search('सब्ज़ी')).toContain('mandi-auction-slip');
  });

  it('waits for a searchable word: one or two letters and joining words alone search nothing', () => {
    for (const query of ['a', 'e', 'du', 'ka', 'और', 'का', 'पर', 'घी']) expect([query, searchable(index, words(query))]).toEqual([query, []]);
    expect(search('TV')).toEqual(['cable-wifi-receipt']);
    expect(search('gr')).toEqual(['lorry-receipt']);
  });

  it('searches two-letter Hindi words: "जमा", printed on the Kirana card, finds it', () => {
    expect(search('जमा')).toContain('kirana-khata');
    expect(search('घन फुट')).toContain('timber-measurement-slip');
  });

  it('finds temple, gurudwara and committee receipts, not the mandi one letter away', () => {
    for (const query of ['mandir', 'मंदिर', 'temple', 'gurudwara', 'गुरुद्वारा', 'masjid', 'samiti', 'समिति', 'एनजीओ']) {
      expect([query, search(query)]).toEqual([query, expect.arrayContaining(['ngo-receipt'])]);
    }
    expect(ranked('mandir')).toMatchObject({ match: 'name', items: [expect.objectContaining({ id: 'ngo-receipt' })] });
    expect(search('mandir')).not.toContain('mandi-auction-slip');
    for (const query of ['doodh samiti', 'दूध समिति', 'milk society']) expect([query, search(query)]).toEqual([query, ['dairy-collection-slip']]);
    expect(search('टिम्बर')).toEqual(['timber-measurement-slip']);
  });

  it('allows a changed letter only in long words, where it is rarely another real word', () => {
    // dhaba (eatery) is not dhaga (thread); kiraya (rent) is not kirana.
    expect(search('dhaba')).toEqual([]);
    expect(search('kiraya')).toEqual([]);
    expect(search('prescriptiom')).toContain('medical-prescription');
  });

  it('treats a whole word as a word, not as the start of another one', () => {
    // दर्जी (tailor) is not दर्ज करें (record); ईंट (brick) is not इंटरनेट.
    expect(search('दर्जी')).toEqual(['tailoring-measurement']);
    // Construction material lists bricks too, below the kiln.
    expect(search('ईंट')).toEqual(['brick-kiln-token', 'construction-material-inward']);
    expect(search('int')).toEqual(['brick-kiln-token']);
  });

  it('lists names before descriptions, best match first', () => {
    const bills = search('bill');
    expect(bills.slice(0, 2).sort()).toEqual(['caterer-material-bill', 'pesticide-bill']);
    // The lorry receipt only mentions an e-way bill.
    expect(bills.indexOf('lorry-receipt')).toBeGreaterThan(1);
    expect(search('weight')[0]).toBe('factory-weight-slip');
    // The farm group's label says "dairy", but the dairy slips come first.
    expect(search('dairy')[0]).toBe('dairy-collection-slip');
    expect(search('shop')).toContain('kirana-khata');
  });

  it('finds everyday words, trade groups and one-letter typos', () => {
    const cases: [string, string][] = [
      ['invoice', 'pesticide-bill'], ['salary', 'muster-roll'], ['diary', 'dairy-collection-slip'],
      ['kiraana', 'kirana-khata'], ['dukan', 'kirana-khata'], ['kapda', 'tailoring-measurement'], ['mazdur', 'muster-roll'],
      ['हाजरी', 'muster-roll'], ['आढ़तिया', 'mandi-auction-slip'], ['reciept', 'ngo-receipt'], ['kriana', 'kirana-khata'],
      ['shop', 'kirana-khata'], ['shop', 'medical-prescription'], ['farm', 'dairy-collection-slip'], ['crafts', 'handloom-weaver-log'],
      ['दुकान', 'medical-prescription'], ['vegetables', 'caterer-material-bill'],
    ];
    for (const [query, id] of cases) expect([query, search(query)]).toEqual([query, expect.arrayContaining([id])]);
  });

  it('lists the scrap dealer for "scrap" in either script, and the weighbridge for dharam kanta', () => {
    expect(search('scrap')[0]).toBe('scrap-dealer-receipt');
    expect(search('स्क्रैप')[0]).toBe('scrap-dealer-receipt');
    expect(search('धरम कांटा')[0]).toBe('factory-weight-slip');
    expect(search('dharam kanta')[0]).toBe('factory-weight-slip');
  });

  it('finds English trade words written in Devanagari', () => {
    const cases: [string, string][] = [
      ['वाईफाई', 'cable-wifi-receipt'], ['वाई फाई', 'cable-wifi-receipt'], ['वायफाय', 'cable-wifi-receipt'], ['मस्टर रोल', 'muster-roll'],
      ['पेट्रोल पंप', 'fleet-fuel-expense'], ['टेंट हाउस', 'decorator-challan'], ['tent house', 'decorator-challan'], ['बिलटी', 'lorry-receipt'],
    ];
    for (const [query, id] of cases) expect([query, ranked(query).match, search(query)[0]]).toEqual([query, 'name', id]);
  });
});

describe('home page cards', () => {
  // About two lines on a 390px phone at the card's font size.
  const MAX = { en: 60, hi: 48 };
  const graphemes = (text: string) => [...new Intl.Segmenter('hi', { granularity: 'grapheme' }).segment(text)].length;

  it('gives every document type a short line that says what you get', () => {
    for (const p of activeProfiles()) {
      for (const lang of LANGS) {
        const key = `card.${p.id}` as MessageKey;
        const line = translate(lang, key);
        expect([key, lang, line !== key]).toEqual([key, lang, true]);
        expect([line, graphemes(line) <= MAX[lang]]).toEqual([line, true]);
        expect([line, /^(parse|digiti[sz]e|extract|track)\b/i.test(line) || /(डिजिटल करें|निकालें|पढ़ें|दर्ज करें)/.test(line)]).toEqual([line, false]);
      }
    }
  });
});

describe('client/scan-store', () => {
  const scan = (id: string, status: StoredScan['status'], updatedAt: number): StoredScan => ({ id, profileId: 'kirana-khata', createdAt: updatedAt, updatedAt, status });

  it('prunes only old saved scans, never photos that still need the user', () => {
    const waiting = Array.from({ length: 25 }, (_, i) => scan(`offline-${i}`, 'offline', i));
    const failed = [scan('failed', 'failed', 1), scan('partial', 'partial', 2)];
    const saved = Array.from({ length: 23 }, (_, i) => scan(`saved-${i}`, 'saved', 100 + i));
    const extra = prunable([...waiting, ...failed, ...saved], 20).map(s => s.id);
    expect(extra.sort()).toEqual(['saved-0', 'saved-1', 'saved-2']);
    expect(prunable(waiting, 20)).toEqual([]);
  });

  it('reads the recent scans hint: rows that need the user, and the saved-history line', () => {
    expect(parseScanRows('3h')).toEqual({ rows: 3, history: true });
    expect(parseScanRows('2')).toEqual({ rows: 2, history: false });
    expect(parseScanRows('0h')).toEqual({ rows: 0, history: true });
    expect(parseScanRows('99')).toEqual({ rows: 6, history: false });
    expect(parseScanRows('x')).toEqual({ rows: 0, history: false });
    expect(parseScanRows(undefined)).toEqual({ rows: 0, history: false });
  });

  it("lists only the signed-in account's scans; another account's are kept apart", () => {
    const mine = { ...scan('mine', 'failed', 1), owner: 'a' };
    const theirs = { ...scan('theirs', 'offline', 2), owner: 'b' };
    const unowned = scan('unowned', 'partial', 3);
    expect(byOwner([mine, theirs, unowned], 'a')).toEqual({ mine: [mine], others: [theirs, unowned] });
    // No account known: nothing is hidden, as before owners were kept.
    expect(byOwner([mine, theirs], null)).toEqual({ mine: [mine, theirs], others: [] });
  });

  it('keeps the photo and voice-note links and the duplicate choice of a partly saved scan, and retries it with its own id', () => {
    const result = {
      status: 'partial' as const, warnings: [], imageLink: 'https://drive/img', voiceNoteLink: 'https://drive/voice',
      destinations: { media: { status: 'success' as const, code: 'saved' }, sheets: { status: 'failed' as const, code: 'failed' } },
    };
    const fields = [{ key: 'amount', label: 'Amount', value: '500' }];
    const stored = savedScan({ id: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', profileId: 'ngo-receipt', fields, note: '', archive: null, audio: null, duplicateAction: 'replace' }, result, 5);
    expect(stored).toMatchObject({ status: 'partial', updatedAt: 5, imageLink: 'https://drive/img', voiceNoteLink: 'https://drive/voice', duplicateAction: 'replace' });
    expect(retryInput(stored, ['sheets'])).toMatchObject({
      profileId: 'ngo-receipt', fields, only: ['sheets'], saveId: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', duplicateAction: 'replace',
      imageLink: 'https://drive/img', voiceNoteLink: 'https://drive/voice',
    });
    // No duplicate choice made: Home can't ask, so the row is added next to the old one.
    expect(retryInput({ ...stored, duplicateAction: undefined }, ['sheets']).duplicateAction).toBe('keep_both');
  });

  describe('claiming the device for the signed-in account', () => {
    const storage = new Map<string, string>();
    beforeAll(() => {
      (globalThis as { localStorage?: unknown }).localStorage = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
      };
    });
    afterAll(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });
    beforeEach(() => storage.clear());

    // A fresh module each time: the claim is made once per account and page load.
    const fresh = () => {
      let store!: typeof import('@/client/scan-store');
      jest.isolateModules(() => { store = jest.requireActual('@/client/scan-store'); });
      return store;
    };

    it("reports the account stamped before and stamps the new one, deleting no scans, with the header's key", async () => {
      storage.set('docsync_owner', 'account-a');
      const { claimScans } = fresh();
      expect(OWNER_KEY).toBe('docsync_owner');
      // Both the header and Home claim; they get the same answer, so the header still sees the switch.
      const [header, home] = await Promise.all([claimScans('account-b'), claimScans('account-b')]);
      expect([header, home]).toEqual(['account-a', 'account-a']);
      expect(storage.get('docsync_owner')).toBe('account-b');
      expect(storage.has('docsync_scan_owner')).toBe(false);
    });

    it('adopts an unstamped device and keeps the same account', async () => {
      expect(await fresh().claimScans('account-a')).toBeNull();
      expect(storage.get('docsync_owner')).toBe('account-a');
      expect(await fresh().claimScans('account-a')).toBe('account-a');
    });
  });

  it('reads the recent document types cookie, dropping unknown ids', () => {
    expect(parseRecentApps('lorry-receipt.nope.kirana-khata.lorry-receipt', ['kirana-khata', 'lorry-receipt'])).toEqual(['lorry-receipt', 'kirana-khata']);
    expect(parseRecentApps(undefined, ['kirana-khata'])).toEqual([]);
  });
});
