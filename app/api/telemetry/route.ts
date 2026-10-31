import { NextRequest, NextResponse } from 'next/server';
import { resolveCaller, unauthorized } from '@/core/http';
import { logEvents, MAX_EVENTS_PER_REQUEST, sanitizeEvent, type TelemetryEvent } from '@/core/telemetry';

/** Accepts `{ event, props }` or `{ events: [...] }`; unknown events and props are dropped silently. */
export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (!caller) return unauthorized();

  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.events) ? body.events : body ? [body] : [];
  const events = raw.slice(0, MAX_EVENTS_PER_REQUEST).map(sanitizeEvent).filter((e): e is TelemetryEvent => e !== null);
  logEvents(events);
  return new NextResponse(null, { status: 204 });
}
