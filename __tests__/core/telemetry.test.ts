import { logEvents, sanitizeEvent, scrub, TELEMETRY_EVENTS } from '@/core/telemetry';

describe('core/telemetry', () => {
  afterEach(() => jest.restoreAllMocks());

  it('accepts only allow-listed events and props', () => {
    expect(sanitizeEvent({ event: 'sync_finished', props: { profile: 'ngo-receipt', ms: 1200, mock: false, sheets: 'saved', donorName: 'Asha', nested: { a: 1 } } }))
      .toEqual({ event: 'sync_finished', props: { profile: 'ngo-receipt', ms: 1200, mock: false, sheets: 'saved' } });
    expect(sanitizeEvent({ event: 'steal_data' })).toBeNull();
    expect(sanitizeEvent({ event: 42 })).toBeNull();
    expect(sanitizeEvent(null)).toBeNull();
    expect(sanitizeEvent('scan_opened')).toBeNull();
    expect(sanitizeEvent({ event: 'scan_opened', props: ['x'] })).toEqual({ event: 'scan_opened', props: {} });
    expect(TELEMETRY_EVENTS).toContain('client_error');
  });

  it('drops non-finite numbers and caps string lengths', () => {
    const out = sanitizeEvent({ event: 'client_error', props: { ms: Infinity, count: NaN, code: 'x'.repeat(100), message: 'm'.repeat(500), path: `/scan/${'p'.repeat(200)}?token=secret` } });
    expect(out?.props.ms).toBeUndefined();
    expect(out?.props.count).toBeUndefined();
    expect(out?.props.code).toHaveLength(60);
    expect(out?.props.message).toHaveLength(300);
    expect(out?.props.path).toHaveLength(100);
    expect(String(out?.props.path)).not.toContain('token');
  });

  it('scrubs emails and long digit runs from messages and paths', () => {
    expect(scrub('failed for asha@example.org, phone 9876543210, receipt 12345')).toBe('failed for [email], phone [number], receipt 12345');
    const out = sanitizeEvent({ event: 'client_error', props: { message: 'Error for a@b.co', path: '/scan/ngo-receipt/1234567?x=1' } });
    expect(out?.props).toEqual({ message: 'Error for [email]', path: '/scan/ngo-receipt/[number]' });
  });

  it('logs one JSON line per event, with no caller identity', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    logEvents([{ event: 'scan_opened', props: { profile: 'ngo-receipt' } }, { event: 'retry', props: {} }], new Date('2026-01-01T00:00:00Z'));
    expect(info).toHaveBeenCalledTimes(2);
    expect(JSON.parse(info.mock.calls[0][0] as string)).toEqual({ type: 'telemetry', at: '2026-01-01T00:00:00.000Z', event: 'scan_opened', profile: 'ngo-receipt' });
  });
});
