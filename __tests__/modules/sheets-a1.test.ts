import { buildRow, columnLetter, keyValueForMatch, mergeHeaders, META_COLUMNS, sanitizeCell, syncStatusText } from '@/modules/sheets';
import { retriedSyncStatus, rowHoldsFields, syncStatusFailures } from '@/modules/sheets/a1';

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

  it("a Hindi user's new sheet gets Hindi headings for the app's own columns, and both languages are recognised", () => {
    const fields = [{ key: 'राशि', label: 'राशि', value: '500' }];
    const hindi = mergeHeaders([], fields, 'hi').headers;
    expect(hindi).toEqual(['राशि', ...META_COLUMNS.map(m => m.labelHi)]);
    expect(mergeHeaders(hindi, fields, 'hi').changed).toBe(false);
    expect(buildRow(hindi, fields, meta)).toEqual(['500', 'n', 'v', 'i', 't', 'Success']);
    // An English sheet stays English for a Hindi user, and the other way round.
    expect(mergeHeaders(['राशि', ...metaLabels], fields, 'hi').changed).toBe(false);
    expect(mergeHeaders(hindi, [{ key: 'phone', label: 'Phone', value: '9' }], 'en').headers).toEqual(['राशि', 'Phone', ...META_COLUMNS.map(m => m.labelHi)]);
  });

  it('adds the Save ID column only when asked, once, and never puts a field in it', () => {
    const fields = [{ key: 'amount', label: 'Amount', value: '500' }];
    expect(mergeHeaders([], fields, 'en', true).headers).toEqual(['Amount', ...metaLabels, 'Save ID']);
    expect(mergeHeaders([], fields, 'hi', true).headers.at(-1)).toBe('सेव आईडी');
    // An older sheet: the column goes in with the new columns, before the metadata ones.
    expect(mergeHeaders(['Amount', ...metaLabels], fields, 'en', true)).toEqual({ headers: ['Amount', 'Save ID', ...metaLabels], changed: true, insert: { at: 1, count: 1 } });
    expect(mergeHeaders(['Amount', ...metaLabels, 'Save ID'], fields, 'en', true).changed).toBe(false);
    expect(mergeHeaders(['Amount', ...metaLabels], fields, 'en').changed).toBe(false);
    expect(buildRow(['Amount', 'Save ID', 'Sync Status'], [...fields, { key: 'saveId', label: 'Save ID', value: 'x' }], { ...meta, saveId: 'id-1' })).toEqual(['500', 'id-1', 'Success']);
    expect(buildRow(['Amount', 'Save ID'], fields, meta)).toEqual(['500', '']);
  });

  it('reads which destinations a Sync Status names as failed, in either language', () => {
    expect(syncStatusFailures('Partial (Notion, media upload failed)')).toEqual(['Notion', 'media upload']);
    expect(syncStatusFailures('अधूरा (मीडिया अपलोड नहीं हुआ)')).toEqual(['media upload']);
    expect(syncStatusFailures('Success')).toEqual([]);
    expect(syncStatusFailures('checked by Ramesh')).toEqual([]);
  });

  it('writes the Sync Status in Hindi for Hindi users, and retries keep the language a row was written in', () => {
    expect(syncStatusText([], 'hi')).toBe('सफल');
    expect(syncStatusText(['Notion', 'media upload'], 'hi')).toBe('अधूरा (Notion, मीडिया अपलोड नहीं हुआ)');
    expect(retriedSyncStatus('अधूरा (Notion, मीडिया अपलोड नहीं हुआ)', ['media upload'], [], 'en')).toBe('अधूरा (Notion नहीं हुआ)');
    expect(retriedSyncStatus('अधूरा (Notion नहीं हुआ)', ['Notion'], [])).toBe('सफल');
    expect(retriedSyncStatus('Partial (Notion failed)', ['Notion'], [], 'hi')).toBe('Success');
    expect(retriedSyncStatus('', [], ['Notion'], 'hi')).toBe('अधूरा (Notion नहीं हुआ)');
    expect(retriedSyncStatus('रमेश ने देखा', ['Notion'], [], 'hi')).toBe('रमेश ने देखा');
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

  it('retriedSyncStatus drops destinations that worked on the retry and keeps ones that failed again', () => {
    expect(retriedSyncStatus('Partial (Notion, media upload failed)', ['Notion'], [])).toBe('Partial (media upload failed)');
    expect(retriedSyncStatus('Partial (Notion failed)', ['Notion'], [])).toBe('Success');
    expect(retriedSyncStatus('Partial (Notion failed)', [], ['Notion'])).toBe('Partial (Notion failed)');
    expect(retriedSyncStatus('Success', ['Notion'], [])).toBe('Success');
    expect(retriedSyncStatus('', ['media upload'], [])).toBe('Success');
    expect(retriedSyncStatus('checked by Ramesh', ['Notion'], [])).toBe('checked by Ramesh');
    expect(syncStatusText(['Notion', 'media upload'])).toBe('Partial (Notion, media upload failed)');
  });

  it('rowHoldsFields compares values as the sheet shows them', () => {
    const headers = ['Receipt No', 'Amount', 'Date', ...metaLabels];
    const fields = [
      { key: 'receiptNo', label: 'Receipt No', value: '000412' },
      { key: 'amount', label: 'Amount', value: '1,500.50' },
      { key: 'date', label: 'Date', value: '05/11/2026' },
    ];
    expect(rowHoldsFields(headers, fields, ['412', 1500.5, '05/11/2026', 'other note', '', '—', 't', 'Success'])).toBe(true);
    expect(rowHoldsFields(headers, fields, ['412', '1500', '05/11/2026'])).toBe(false);
    expect(rowHoldsFields(headers, fields.map(f => ({ ...f, value: '' })), ['', '', ''])).toBe(false);
    // An en_IN sheet stores "₹1,540" as currency and shows it as "₹1,540.00" (or "₹1,00,000.00").
    const money = [fields[0], { key: 'amount', label: 'Amount', value: '₹1,540' }];
    expect(rowHoldsFields(headers, money, ['412', '₹1,540.00'])).toBe(true);
    expect(rowHoldsFields(headers, [fields[0], { key: 'amount', label: 'Amount', value: 'Rs. 100000' }], ['412', '₹1,00,000.00'])).toBe(true);
    expect(rowHoldsFields(headers, money, ['412', '₹1,450.00'])).toBe(false);
  });
});
