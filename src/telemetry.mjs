import { CLIENT_EVENTS, safeRoute, ERROR_TYPES } from '../shared/telemetry.mjs';
let sent = 0;
export function reportClientError(event, route = 'unknown', requestId, location = {}) {
  if (!CLIENT_EVENTS.includes(event) || sent >= 5) return;
  sent++;
  const body = { event, route: safeRoute(route) };
  if (/^[a-f0-9-]{36}$/.test(requestId || '')) body.requestId = requestId;
  if (/^index-[A-Za-z0-9_-]+\.js$/.test(location.asset || '')) body.asset = location.asset;
  for (const key of ['line', 'column']) if (Number.isInteger(location[key]) && location[key] >= 0 && location[key] <= 10000000) body[key] = location[key];
  if (ERROR_TYPES.includes(location.errorType)) body.errorType = location.errorType;
  // Telemetry must never retry recursively or include exception messages, URLs, or input values.
  fetch('/api/client-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
}
export function errorLocation(error) {
  const frame = String(error?.stack || '').match(/\/assets\/(index-[A-Za-z0-9_-]+\.js):(\d+):(\d+)/);
  return { errorType: error?.name, ...(frame ? { asset: frame[1], line: Number(frame[2]), column: Number(frame[3]) } : {}) };
}
export function installClientTelemetry() {
  window.addEventListener('error', event => reportClientError('javascript_error', 'unknown', undefined, errorLocation(event.error)));
  window.addEventListener('unhandledrejection', event => reportClientError('unhandled_rejection', 'unknown', undefined, errorLocation(event.reason)));
}

