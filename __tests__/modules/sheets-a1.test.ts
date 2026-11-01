import { buildRow, columnLetter, keyValueForMatch, mergeHeaders, META_COLUMNS, sanitizeCell } from '@/modules/sheets';

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

  it('existing rows keep their notes, links and timestamps under their own headings when a field is added', () => {
    const existing = ['Date', 'Amount', ...metaLabels];
    const oldRow = ['01/11', '500', 'old note', 'old voice', 'old image', 'old time', 'Success'];
    const { headers, insert } = mergeHeaders(existing, [{ key: 'phone', label: 'Phone', value: '98' }]);
    expect(insert).toEqual({ at: 2, count: 1 });
    // What insertDimension does to every existing row.
    const moved = [...oldRow];
    moved.splice(insert!.at, 0, ...Array(insert!.count).fill(''));
    const cell = (label: string) => moved[headers.indexOf(label)];
    expect([cell('Date'), cell('Amount'), cell('Phone')]).toEqual(['01/11', '500', '']);
    expect(metaLabels.map(cell)).toEqual(['old note', 'old voice', 'old image', 'old time', 'Success']);
    // A field added after the last column moves nothing.
    expect(mergeHeaders(['Date'], [{ key: 'phone', label: 'Phone', value: '' }]).insert).toBeUndefined();
  });

  it('Hindi field names find their column again instead of adding one on every save', () => {
    const fields = [{ key: 'रसीदनंबर', label: 'रसीद नंबर', value: '412' }, { key: 'field', label: 'राशि', value: '500' }];
    const first = mergeHeaders([], fields).headers;
    expect(first.slice(0, 2)).toEqual(['रसीद नंबर', 'राशि']);
    expect(mergeHeaders(first, fields)).toEqual({ headers: first, changed: false });
    expect(buildRow(first, fields, meta).slice(0, 2)).toEqual(['412', '500']);
    // A different Hindi field is a new column, not a match for the first Hindi column.
    expect(mergeHeaders(first, [{ key: 'field', label: 'तारीख', value: '1/11' }]).headers).toEqual(['रसीद नंबर', 'राशि', 'तारीख', ...metaLabels]);
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

  it('two fields with the same label fill two columns instead of one value landing twice', () => {
    const fields = [{ key: 'amount', label: 'Amount', value: '100' }, { key: 'amount2', label: 'Amount', value: '250' }];
    const { headers } = mergeHeaders(['Amount', ...metaLabels], fields);
    expect(headers).toEqual(['Amount', 'Amount', ...metaLabels]);
    expect(buildRow(headers, fields, meta).slice(0, 2)).toEqual(['100', '250']);
    // a column named after a key is matched by key first
    expect(buildRow(['amount2', 'Amount'], fields, meta)).toEqual(['250', '100']);
  });

  it('a "Notes" line from the slip gets its own column and never replaces the voice-note text', () => {
    const fields = [{ key: 'notes', label: 'Notes', value: 'paid half' }];
    const { headers } = mergeHeaders(['Amount', ...metaLabels], fields);
    expect(headers).toEqual(['Amount', 'Notes (on document)', ...metaLabels]);
    const row = buildRow(headers, fields, meta);
    expect(row[1]).toBe('paid half');
    expect(row[2]).toBe('n');
    expect(mergeHeaders([], fields).headers[0]).toBe('Notes (on document)');
  });

  it('keeps identifiers exactly as written', () => {
    expect(sanitizeCell('000412')).toBe("'000412");
    expect(sanitizeCell('+919876543210')).toBe("'+919876543210");
    expect(sanitizeCell('356789012345678')).toBe("'356789012345678");
    expect(sanitizeCell('0')).toBe('0');
    expect(sanitizeCell('0.5')).toBe('0.5');
    expect(sanitizeCell('15000')).toBe('15000');
  });

  it('duplicate keys match however Sheets or the writer formatted them', () => {
    expect(keyValueForMatch('000412')).toBe(keyValueForMatch(412));
    expect(keyValueForMatch('r/412')).toBe(keyValueForMatch('R-412'));
    expect(keyValueForMatch(' MH 12 AB 1234 ')).toBe(keyValueForMatch('MH-12-AB-1234'));
    expect(keyValueForMatch('0')).toBe('0');
    expect(keyValueForMatch('R-1')).not.toBe(keyValueForMatch('R-2'));
  });
});
