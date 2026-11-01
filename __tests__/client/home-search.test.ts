import { en } from '@/client/i18n/en';
import { hi } from '@/client/i18n/hi';
import { translate } from '@/client/i18n';
import type { MessageKey } from '@/client/i18n/en';
import { activeProfiles, localizedProfile } from '@/modules/profiles';
import { rank, searchIndex, searchTextFor, words } from '@/app/components/AppPicker.search';
import { parseRecentApps, parseScanRows, prunable, type StoredScan } from '@/client/scan-store';

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
const search = (query: string) => rank(index, words(query)).map(app => app.id);

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
      ['invoice', 'pesticide-bill'], ['salary', 'muster-roll'], ['fees', 'cable-wifi-receipt'], ['diary', 'dairy-collection-slip'],
      ['kiraana', 'kirana-khata'], ['dukan', 'kirana-khata'], ['kapda', 'tailoring-measurement'], ['mazdur', 'muster-roll'],
      ['हाजरी', 'muster-roll'], ['आढ़तिया', 'mandi-auction-slip'], ['reciept', 'ngo-receipt'], ['kriana', 'kirana-khata'],
      ['shop', 'kirana-khata'], ['shop', 'medical-prescription'], ['farm', 'dairy-collection-slip'], ['crafts', 'handloom-weaver-log'],
      ['दुकान', 'medical-prescription'], ['vegetables', 'caterer-material-bill'],
    ];
    for (const [query, id] of cases) expect([query, search(query)]).toEqual([query, expect.arrayContaining([id])]);
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

  it('reads the recent document types cookie, dropping unknown ids', () => {
    expect(parseRecentApps('lorry-receipt.nope.kirana-khata.lorry-receipt', ['kirana-khata', 'lorry-receipt'])).toEqual(['lorry-receipt', 'kirana-khata']);
    expect(parseRecentApps(undefined, ['kirana-khata'])).toEqual([]);
  });
});
