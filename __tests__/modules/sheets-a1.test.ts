import { buildRow, columnLetter, mergeHeaders, META_COLUMNS, sanitizeCell } from '@/modules/sheets';

const meta = { notes: 'n', voiceNoteLink: 'v', imageLink: 'i', syncedAt: 't', syncStatus: 'Success' };
const metaLabels = META_COLUMNS.map(m => m.label);

describe('modules/sheets a1 helpers', () => {
  it('columnLetter handles columns past Z', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(26)).toBe('Z');
    expect(columnLetter(27)).toBe('AA');
    expect(columnLetter(52)).toBe('AZ');
    expect(columnLetter(702)).toBe('ZZ');
    expect(columnLetter(703)).toBe('AAA');
  });

  it('an empty sheet gets every field plus metadata columns', () => {
    const { headers, changed } = mergeHeaders([], [{ key: 'donorName', label: 'Donor Name', value: '' }]);
    expect(changed).toBe(true);
    expect(headers).toEqual(['Donor Name', ...metaLabels]);
  });

  it('new fields are inserted before the metadata columns', () => {
    const existing = ['Date', 'Donor Name', ...metaLabels];
    const { headers } = mergeHeaders(existing, [
      { key: 'donor_name', label: 'Donor', value: '' },
      { key: 'receiptNumber', label: 'Receipt Number', value: '' },
    ]);
    expect(headers).toEqual(['Date', 'Donor Name', 'Receipt Number', ...metaLabels]);
  });

  it('reports no change when every field already has a column', () => {
    expect(mergeHeaders(['Amount'], [{ key: 'amount', label: 'Amount', value: '1' }]).changed).toBe(false);
  });

  it('buildRow maps fields and metadata (including legacy snake_case headers)', () => {
    const row = buildRow(
      ['Donor Name', 'Amount', 'missing', 'link_to_image', 'Synced At', 'notes', 'voice_note_link', 'Sync Status'],
      [{ key: 'donorName', label: 'Donor Name', value: 'Asha' }, { key: 'amount', label: 'Amount (₹)', value: '500' }],
      meta,
    );
    expect(row).toEqual(['Asha', '500', '', 'i', 't', 'n', 'v', 'Success']);
  });

  it('neutralizes formulas but keeps numbers', () => {
    expect(sanitizeCell('=IMPORTXML("http://evil")')).toBe('\'=IMPORTXML("http://evil")');
    expect(sanitizeCell('+cmd')).toBe("'+cmd");
    expect(sanitizeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeCell('-500')).toBe('-500');
    expect(sanitizeCell('+91,000.5')).toBe('+91,000.5');
    expect(sanitizeCell('Rahul')).toBe('Rahul');
    expect(sanitizeCell(5)).toBe(5);
    expect(sanitizeCell(null)).toBe('');
  });
});
