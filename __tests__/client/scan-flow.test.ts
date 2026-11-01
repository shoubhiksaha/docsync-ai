import {
  activeFields,
  applyTemplate,
  canAutoSave,
  canConfirm,
  failedDestinations,
  fieldSignature,
  fieldStatus,
  initialScanState,
  keyFromLabel,
  mergeRetry,
  needsAttention,
  saveResultFrom,
  scanReducer,
  toSyncFields,
  type ReviewField,
  type SaveResult,
  type ScanState,
} from '@/client/scan-flow';

const page = new Blob(['x'], { type: 'image/jpeg' });
const saved = { status: 'success' as const, code: 'saved' };
const failed = { status: 'failed' as const, code: 'failed', detail: 'timeout' };
const skipped = { status: 'skipped' as const, code: 'not_connected' };
const extraction = {
  fields: [
    { key: 'receiptNumber', label: 'Receipt Number', value: 'R-1', confidence: 98 },
    { key: 'amount', label: 'Amount', value: '5000', confidence: 70 },
    { key: 'ngoName', label: 'NGO Name', value: 'Helping Hands', confidence: 99 },
  ],
};

function reviewing(): ScanState {
  const captured = scanReducer(initialScanState, { type: 'captured', pages: [page], scanId: 's1' });
  return scanReducer(scanReducer(captured, { type: 'extract-start' }), { type: 'extract-ok', extraction, template: null });
}

describe('client/scan-flow helpers', () => {
  it('builds camelCase keys from any label, including Hindi', () => {
    expect(keyFromLabel('Receipt number')).toBe('receiptNumber');
    expect(keyFromLabel('  PAN / Govt. ID ')).toBe('panGovtId');
    expect(keyFromLabel('रसीद संख्या')).toBe('रसीदसंख्या');
    expect(keyFromLabel('---')).toMatch(/^field_/);
  });

  it('keeps a confidence of 0 as 0 (missing fields must not look certain)', () => {
    const [field] = applyTemplate([{ key: 'a', label: 'A', value: '', confidence: 0 }], null);
    expect(field.confidence).toBe(0);
    expect(fieldStatus(field)).toBe('missing');
    const [noScore] = applyTemplate([{ key: 'b', value: 'x' }], null);
    expect(noScore.confidence).toBe(0);
    expect(noScore.label).toBe('b');
  });

  it('applies remembered fields: saved order, empty placeholders for missing ones, extras start removed', () => {
    const fields = applyTemplate(extraction.fields, {
      fields: [{ key: 'amount', label: 'Donation' }, { key: 'panNumber', label: 'PAN' }, { key: 'receiptNumber', label: 'Receipt' }],
    });
    expect(fields.map(f => [f.key, f.label, f.removed])).toEqual([
      ['amount', 'Donation', false],
      ['panNumber', 'PAN', false],
      ['receiptNumber', 'Receipt', false],
      ['ngoName', 'NGO Name', true],
    ]);
    expect(fields[1]).toMatchObject({ value: '', confidence: 0, origin: 'template' });
  });

  it('flags low-confidence fields until the user edits them', () => {
    const state = reviewing();
    expect(needsAttention(state.fields)).toBe(1);
    const amount = state.fields.find(f => f.key === 'amount')!;
    expect(fieldStatus(amount)).toBe('check');
    const edited = scanReducer(state, { type: 'edit', id: amount.id, value: '5,000' });
    expect(needsAttention(edited.fields)).toBe(0);
  });

  it('lets the user mark a flagged value as right without changing it, and undo that', () => {
    const state = reviewing();
    const amount = state.fields.find(f => f.key === 'amount')!;
    expect(canConfirm(amount)).toBe(true);
    expect(canConfirm(state.fields.find(f => f.key === 'ngoName')!)).toBe(false);
    const confirmed = scanReducer(state, { type: 'confirm', id: amount.id, confirmed: true });
    expect(needsAttention(confirmed.fields)).toBe(0);
    expect(confirmed.fields.find(f => f.key === 'amount')).toMatchObject({ value: '5000', edited: false, confirmed: true });
    expect(confirmed.changed).toBe(true);
    const undone = scanReducer(confirmed, { type: 'confirm', id: amount.id, confirmed: false });
    expect(needsAttention(undone.fields)).toBe(1);
    // An empty value can't be confirmed: it is missing, not uncertain.
    const emptied = scanReducer(state, { type: 'edit', id: amount.id, value: ' ' });
    expect(canConfirm(emptied.fields.find(f => f.key === 'amount')!)).toBe(false);
  });

  it('auto-saves only remembered, confident, warning-free, non-sample results', () => {
    const template = { fields: [{ key: 'receiptNumber', label: 'Receipt' }, { key: 'ngoName', label: 'NGO' }] };
    const fields = applyTemplate(extraction.fields, template);
    expect(canAutoSave(fields, extraction, template)).toBe(true);
    expect(canAutoSave(fields, { ...extraction, isMock: true }, template)).toBe(false);
    expect(canAutoSave(fields, { ...extraction, warnings: ['PAN missing'] }, template)).toBe(false);
    expect(canAutoSave(fields, extraction, null)).toBe(false);
    const withLowConfidence = applyTemplate(extraction.fields, { fields: [{ key: 'amount', label: 'Amount' }] });
    expect(canAutoSave(withLowConfidence, extraction, { fields: [{ key: 'amount', label: 'Amount' }] })).toBe(false);
  });

  it('signs field layouts independent of order and duplicates', () => {
    expect(fieldSignature([{ key: 'b' }, { key: 'a' }, { key: 'a' }])).toBe(fieldSignature([{ key: 'a' }, { key: 'b' }]));
    expect(fieldSignature([{ key: 'a' }])).not.toBe(fieldSignature([{ key: 'a' }, { key: 'b' }]));
  });

  it('sends only active fields, trimmed, with a fallback label', () => {
    const fields: ReviewField[] = [
      { id: '1', key: 'a', label: ' A ', value: ' 1 ', confidence: 90, removed: false, origin: 'ai', edited: false },
      { id: '2', key: 'b', label: '', value: '2', confidence: 90, removed: false, origin: 'ai', edited: false },
      { id: '3', key: 'c', label: 'C', value: '3', confidence: 90, removed: true, origin: 'ai', edited: false },
    ];
    expect(toSyncFields(fields)).toEqual([{ key: 'a', label: 'A', value: '1' }, { key: 'b', label: 'b', value: '2' }]);
    expect(activeFields(fields)).toHaveLength(2);
  });
});

describe('client/scan-flow save results', () => {

  it('derives the overall status from per-destination outcomes', () => {
    expect(saveResultFrom({ destinations: { sheets: saved, notion: skipped, media: saved } }).status).toBe('saved');
    expect(saveResultFrom({ destinations: { sheets: saved, notion: failed } }).status).toBe('partial');
    expect(saveResultFrom({ destinations: { sheets: failed, notion: failed } }).status).toBe('failed');
    expect(saveResultFrom({ success: true }).status).toBe('saved');
    expect(saveResultFrom({ partial: true }).status).toBe('partial');
    expect(saveResultFrom({}).status).toBe('failed');
    expect(saveResultFrom({ destinations: { sheets: saved }, spreadsheetUrl: null }).spreadsheetUrl).toBeUndefined();
  });

  it('merges a retry without overwriting destinations that were not retried', () => {
    const first: SaveResult = { status: 'partial', destinations: { sheets: saved, notion: failed }, spreadsheetUrl: 'https://s', warnings: ['w1'] };
    expect(failedDestinations(first)).toEqual(['notion']);
    const retry = saveResultFrom({ destinations: { sheets: { status: 'skipped', code: 'not_retried' }, notion: saved }, warnings: ['w1', 'w2'] });
    const merged = mergeRetry(first, retry);
    expect(merged.status).toBe('saved');
    expect(merged.destinations.sheets).toEqual(saved);
    expect(merged.spreadsheetUrl).toBe('https://s');
    expect(merged.warnings).toEqual(['w1', 'w2']);
    expect(failedDestinations(null)).toEqual([]);
  });

  it('keeps both outcomes when two retries finish one after the other', () => {
    const first: SaveResult = { status: 'partial', destinations: { sheets: saved, notion: failed, media: failed }, warnings: [] };
    const notionRetry = saveResultFrom({ destinations: { sheets: { status: 'skipped', code: 'not_retried' }, notion: saved, media: { status: 'skipped', code: 'not_retried' } } });
    const mediaRetry = saveResultFrom({ destinations: { sheets: { status: 'skipped', code: 'not_retried' }, notion: { status: 'skipped', code: 'not_retried' }, media: saved } });
    // Each retry merges into the latest result, not the one it started from.
    const both = mergeRetry(mergeRetry(first, notionRetry), mediaRetry);
    expect(both.status).toBe('saved');
    expect(failedDestinations(both)).toEqual([]);
  });
});

describe('client/scan-flow reducer', () => {
  it('walks capture → extracting → review → saving → done', () => {
    const state = reviewing();
    expect(state.step).toBe('review');
    expect(state.pages).toEqual([page]);
    const saving = scanReducer(state, { type: 'save-start' });
    expect(saving.step).toBe('saving');
    const done = scanReducer(saving, { type: 'save-ok', result: saveResultFrom({ destinations: { sheets: saved } }) });
    expect(done.step).toBe('done');
    expect(scanReducer(done, { type: 'reset' })).toBe(initialScanState);
  });

  it('keeps the photo on extraction failure so the user can retry', () => {
    const captured = scanReducer(initialScanState, { type: 'captured', pages: [page], scanId: 's1' });
    const failedState = scanReducer(scanReducer(captured, { type: 'extract-start' }), { type: 'extract-failed', error: 'quota' });
    expect(failedState).toMatchObject({ step: 'capture', error: 'quota', pages: [page] });
  });

  it('stays on review with the edits when nothing was saved anywhere', () => {
    const state = scanReducer(reviewing(), { type: 'save-start' });
    const result = saveResultFrom({ destinations: { sheets: failed } });
    expect(scanReducer(state, { type: 'save-ok', result })).toMatchObject({ step: 'review', error: 'unavailable' });
    expect(scanReducer(state, { type: 'save-failed', error: 'network' })).toMatchObject({ step: 'review', error: 'network' });
  });

  it('edits, renames, removes, restores and adds fields; any edit cancels auto-save', () => {
    let state: ScanState = { ...reviewing(), autoSave: true };
    const [first] = state.fields;
    state = scanReducer(state, { type: 'rename', id: first.id, label: 'Receipt no.' });
    expect(state.autoSave).toBe(false);
    expect(state.fields[0].label).toBe('Receipt no.');
    state = scanReducer(state, { type: 'remove', id: first.id });
    expect(activeFields(state.fields)).toHaveLength(2);
    state = scanReducer(state, { type: 'restore', id: first.id });
    expect(activeFields(state.fields)).toHaveLength(3);
    state = scanReducer(state, { type: 'add', label: 'Donor PAN', value: 'ABCDE1234F' });
    expect(state.fields.at(-1)).toMatchObject({ key: 'donorPan', origin: 'user', edited: true, confidence: 100 });
    expect(scanReducer(state, { type: 'add', label: '  ', value: 'x' })).toBe(state);
  });

  it('tracks notes, audio, auto-save cancel and duplicates', () => {
    const audio = new Blob(['a'], { type: 'audio/webm' });
    let state = scanReducer({ ...reviewing(), autoSave: true }, { type: 'auto-save-cancel' });
    expect(state.autoSave).toBe(false);
    state = scanReducer(state, { type: 'note', value: 'cash' });
    state = scanReducer(state, { type: 'audio', blob: audio });
    expect(state).toMatchObject({ note: 'cash', audio });
    state = scanReducer(scanReducer(state, { type: 'save-start' }), { type: 'duplicate', info: { count: 1, label: 'Receipt', value: 'R-1' } });
    expect(state).toMatchObject({ step: 'review', duplicate: { count: 1 } });
    expect(scanReducer(state, { type: 'duplicate-close' }).duplicate).toBeNull();
  });

  it('drops a reading that finishes after Cancel or after the review is already open', () => {
    const cancelled = scanReducer(scanReducer(reviewing(), { type: 'reset' }), { type: 'extract-ok', extraction, template: null });
    expect(cancelled).toBe(initialScanState);
    expect(scanReducer(initialScanState, { type: 'extract-failed', error: 'network' })).toBe(initialScanState);
    const review = reviewing();
    expect(scanReducer(review, { type: 'extract-ok', extraction: { fields: [] }, template: null })).toBe(review);
  });

  it('marks the review as changed only after the user changes something', () => {
    const template = { fields: [{ key: 'amount', label: 'Amount' }] };
    const captured = scanReducer(scanReducer(initialScanState, { type: 'captured', pages: [page], scanId: 's1' }), { type: 'extract-start' });
    // Template extras start removed, but that isn't the user's change.
    const fresh = scanReducer(captured, { type: 'extract-ok', extraction, template });
    expect(fresh.fields.some(f => f.removed)).toBe(true);
    expect(fresh.changed).toBe(false);
    expect(scanReducer(fresh, { type: 'edit', id: fresh.fields[0].id, value: '1' }).changed).toBe(true);
    expect(scanReducer(fresh, { type: 'remove', id: fresh.fields[0].id }).changed).toBe(true);
    expect(scanReducer(fresh, { type: 'note', value: 'x' }).changed).toBe(true);
    expect(scanReducer(scanReducer(fresh, { type: 'note', value: 'x' }), { type: 'reset' }).changed).toBe(false);
  });

  it('appends a voice transcript to the note as it is by then', () => {
    let state = scanReducer({ ...reviewing(), autoSave: true }, { type: 'note-append', text: ' from voice ' });
    expect(state).toMatchObject({ note: 'from voice', autoSave: false, changed: true });
    state = scanReducer(scanReducer(state, { type: 'note', value: 'typed meanwhile' }), { type: 'note-append', text: 'second' });
    expect(state.note).toBe('typed meanwhile\n\nsecond');
    expect(scanReducer(state, { type: 'note-append', text: '  ' })).toBe(state);
  });

  it('restores a kept scan straight into the review with its checked values', () => {
    const audio = new Blob(['a'], { type: 'audio/webm' });
    const state = scanReducer(reviewing(), {
      type: 'restored', pages: [page], scanId: 'kept', note: 'n', audio,
      fields: [{ key: 'amount', label: 'Amount', value: '500' }, { key: 'pan', label: 'PAN', value: '' }],
    });
    expect(state).toMatchObject({ step: 'review', scanId: 'kept', note: 'n', audio, changed: true, autoSave: false, error: null });
    expect(state.fields.map(f => [f.key, f.value, fieldStatus(f)])).toEqual([['amount', '500', 'ok'], ['pan', '', 'missing']]);
    expect(toSyncFields(state.fields)).toEqual([{ key: 'amount', label: 'Amount', value: '500' }, { key: 'pan', label: 'PAN', value: '' }]);
  });

  it('keeps the fields as sent, so the Done summary and retries match the saved record', () => {
    const review = reviewing();
    const failedSave = scanReducer(scanReducer(review, { type: 'save-start' }), { type: 'save-ok', result: saveResultFrom({ destinations: { sheets: failed } }) });
    const saving = scanReducer(failedSave, { type: 'save-start' });
    expect(saving).toMatchObject({ step: 'saving', result: null, savedFields: toSyncFields(review.fields) });
    // A change that slips in during the save doesn't alter what the Done screen reports.
    const edited = scanReducer(saving, { type: 'edit', id: review.fields[0].id, value: 'R-2' });
    const done = scanReducer(edited, { type: 'save-ok', result: saveResultFrom({ destinations: { sheets: saved } }) });
    expect(done.savedFields?.[0]).toEqual({ key: 'receiptNumber', label: 'Receipt Number', value: 'R-1' });
    expect(scanReducer(done, { type: 'reset' }).savedFields).toBeNull();
  });

  it('replaces business-rule warnings after a change, only while reviewing', () => {
    const review = { ...reviewing(), warnings: ['Amount looks wrong'] };
    expect(scanReducer(review, { type: 'warnings', warnings: [] }).warnings).toEqual([]);
    const saving = scanReducer(review, { type: 'save-start' });
    expect(scanReducer(saving, { type: 'warnings', warnings: [] })).toBe(saving);
  });

  it('merges retries into the done result and ignores them without one', () => {
    const done = scanReducer(scanReducer(reviewing(), { type: 'save-start' }), {
      type: 'save-ok',
      result: saveResultFrom({ destinations: { sheets: saved, notion: failed } }),
    });
    const retried = scanReducer(done, { type: 'retry-ok', result: saveResultFrom({ destinations: { notion: saved } }) });
    expect(retried.result?.status).toBe('saved');
    const fresh = scanReducer(initialScanState, { type: 'retry-ok', result: saveResultFrom({}) });
    expect(fresh).toBe(initialScanState);
  });
});
