import { en } from '@/client/i18n/en';
import { hi } from '@/client/i18n/hi';
import { activeProfiles, localizedProfile } from '@/modules/profiles';
import { matches, searchTextFor, words } from '@/app/components/AppPicker.search';
import { parseRecentApps, prunable, type StoredScan } from '@/client/scan-store';

// The same search text the home page builds.
const index = activeProfiles().map(p => ({
  id: p.id,
  words: words(searchTextFor(p.id, (['en', 'hi'] as const)
    .map(l => localizedProfile(p, l))
    .flatMap(text => [text.title, text.documentName, text.description]))),
}));
const search = (query: string) => index.filter(app => matches(app.words, words(query))).map(app => app.id);

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

  it('reads the recent document types cookie, dropping unknown ids', () => {
    expect(parseRecentApps('lorry-receipt.nope.kirana-khata.lorry-receipt', ['kirana-khata', 'lorry-receipt'])).toEqual(['lorry-receipt', 'kirana-khata']);
    expect(parseRecentApps(undefined, ['kirana-khata'])).toEqual([]);
  });
});
