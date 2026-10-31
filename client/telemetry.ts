/**
 * Privacy-safe usage events and client error reports, sent to /api/telemetry (first party only).
 * Never pass document values, names, emails or keys here; the server drops unknown props anyway.
 */
export type TelemetryEvent =
  | 'scan_opened' | 'photo_added' | 'extract_succeeded' | 'extract_failed' | 'review_confirmed'
  | 'sync_finished' | 'sync_failed' | 'duplicate_found' | 'fields_remembered' | 'fields_forgotten'
  | 'auto_save_cancelled' | 'retry' | 'offline_saved' | 'notion_offer'
  | 'language_changed' | 'client_error';

type Props = Record<string, string | number | boolean | null | undefined>;

const ENDPOINT = '/api/telemetry';
const queue: { event: TelemetryEvent; props: Props }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
const reported = new Set<string>();

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (queue.length === 0) return;
  const body = JSON.stringify({ events: queue.splice(0, 20) });
  try {
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
  } catch {
    // fall through to fetch
  }
  fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
}

export function track(event: TelemetryEvent, props: Props = {}): void {
  if (typeof window === 'undefined') return;
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined && v !== null));
  queue.push({ event, props: clean });
  if (queue.length >= 10) flush();
  else if (!timer) timer = setTimeout(flush, 3000);
}

export function reportError(error: unknown, source: 'boundary' | 'window' | 'route' | 'global', digest?: string): void {
  if (typeof window === 'undefined') return;
  const message = (error instanceof Error ? error.message : String(error ?? 'unknown')).slice(0, 300);
  const id = `${source}:${message}`;
  if (reported.has(id) || reported.size >= 10) return;
  reported.add(id);
  track('client_error', { message, source, path: window.location.pathname, digest });
}

/** Installs global error listeners and flushes queued events when the page is hidden. Idempotent. */
export function installTelemetry(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'window'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}
