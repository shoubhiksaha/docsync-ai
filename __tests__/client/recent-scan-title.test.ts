import { preferredValue } from '@/app/components/RecentScans.title';

const scan = (fields: { key: string; label: string; value: string }[]) => fields;
const valueOf = preferredValue;

describe('recent scan title', () => {
  const DAIRY = ['memberName', 'name', 'farmerName', 'memberCode'];

  it("names a slip by the profile's first choice, not by whichever field comes first on the slip", () => {
    const slip = scan([
      { key: 'memberCode', label: 'Member Code', value: '0427' },
      { key: 'memberName', label: 'Member Name', value: 'Savitri Devi Yadav' },
    ]);
    expect(valueOf(slip, DAIRY)).toBe('Savitri Devi Yadav');
  });

  it('falls back to a later choice when an earlier one is missing or empty', () => {
    expect(valueOf(scan([{ key: 'memberName', label: 'Member Name', value: '  ' }, { key: 'memberCode', label: 'Member Code', value: '0427' }]), DAIRY)).toBe('0427');
    expect(valueOf(scan([{ key: 'x', label: 'Farmer Name', value: 'Ramesh' }]), DAIRY)).toBe('Ramesh');
    expect(valueOf(scan([{ key: 'village', label: 'Village', value: 'Rampur' }]), DAIRY)).toBeUndefined();
  });
});
