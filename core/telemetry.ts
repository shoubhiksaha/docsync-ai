/**
 * Product telemetry — vendor-neutral and privacy-safe.
 *
 * The browser reports funnel events (scan opened → photo added → extracted → saved) and client
 * errors to /api/telemetry; each accepted event becomes one JSON log line that any log drain
 * (Cloud Logging, Datadog, …) can chart. Only allow-listed event names and props get through, strings
 * are length-capped, and emails / long digit runs are scrubbed, so no document content, field
 * value or personal identifier is ever logged.
 */

export const TELEMETRY_EVENTS = [
  'scan_opened', 'photo_added', 'extract_succeeded', 'extract_failed', 'review_confirmed',
  'sync_finished', 'sync_failed', 'duplicate_found', 'fields_remembered', 'fields_forgotten',
  'auto_save_cancelled', 'retry', 'offline_saved', 'notion_offer',
  'language_changed', 'client_error',
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

const PROP_KEYS = new Set([
  'profile', 'ms', 'count', 'pages', 'source', 'code', 'status', 'destination', 'action', 'lang',
  'mock', 'edited', 'removed', 'added', 'sheets', 'notion', 'media', 'message', 'path', 'digest',
]);

const MAX_STRING = 60;
const MAX_MESSAGE = 300;
const MAX_PATH = 100;
export const MAX_EVENTS_PER_REQUEST = 20;

export type TelemetryProps = Record<string, string | number | boolean>;

export interface TelemetryEvent {
  event: TelemetryEventName;
  props: TelemetryProps;
}

/** Removes anything that could identify a person: emails and long digit runs (phones, IDs). */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\d{6,}/g, '[number]');
}

function cleanValue(key: string, value: unknown): string | number | boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  if (key === 'message') return scrub(value).slice(0, MAX_MESSAGE);
  if (key === 'path') return scrub(value.split(/[?#]/)[0]).slice(0, MAX_PATH);
  return value.slice(0, MAX_STRING);
}

/** Returns a safe event, or null when the name isn't allow-listed or the shape is wrong. */
export function sanitizeEvent(raw: unknown): TelemetryEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const { event, props } = raw as { event?: unknown; props?: unknown };
  if (typeof event !== 'string' || !(TELEMETRY_EVENTS as readonly string[]).includes(event)) return null;

  const clean: TelemetryProps = {};
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const [key, value] of Object.entries(props)) {
      if (!PROP_KEYS.has(key)) continue;
      const v = cleanValue(key, value);
      if (v !== undefined) clean[key] = v;
    }
  }
  return { event: event as TelemetryEventName, props: clean };
}

/** One log line per event — never an email or user ID. */
export function logEvents(events: TelemetryEvent[], now = new Date()): void {
  for (const e of events) {
    console.info(JSON.stringify({ type: 'telemetry', at: now.toISOString(), event: e.event, ...e.props }));
  }
}
