import { randomUUID } from 'node:crypto';
import { safeRoute, CLIENT_EVENTS, ERROR_TYPES } from '../shared/telemetry.mjs';
const events = new Set(['request_completed', 'request_failed', 'request_exception', 'validation_failed', 'ai_provider_failed', 'ai_response_invalid', 'shared_store_failed', 'application_failed', 'client_error']);
const names = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'AbortError', 'TimeoutError', 'HttpError', 'GuardError', 'ZodError']);
const issueCodes = new Set(['invalid_type', 'invalid_value', 'too_big', 'too_small', 'unrecognized_keys', 'custom', 'invalid_format']);
const fields = new Set(['q', 'topic', 'region', 'agency', 'page', 'text', 'mode', 'consent', 'profile', 'age', 'childAge', 'housingGoal', 'sex', 'district', 'topics', 'resultTopic', 'preferredTopics', 'includeClosed']);
export const newRequestId = () => randomUUID();
export function logEvent(event, data = {}) {
  if (!events.has(event)) return;
  const row = { app: 'onhye', timestamp: new Date().toISOString(), event };
  if (/^[a-f0-9-]{36}$/.test(data.requestId || '')) row.requestId = data.requestId;
  if (data.route) row.route = safeRoute(data.route);
  if (['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(data.method)) row.method = data.method;
  for (const key of ['status', 'upstreamStatus']) if (Number.isInteger(data[key]) && data[key] >= 100 && data[key] <= 599) row[key] = data[key];
  if (Number.isFinite(data.durationMs)) row.durationMs = Math.min(3600000, Math.max(0, Math.round(data.durationMs)));
  if (typeof data.rewriteParameterPresent === 'boolean') row.rewriteParameterPresent = data.rewriteParameterPresent;
  if (Number.isInteger(data.unexpectedQueryCount)) row.unexpectedQueryCount = Math.min(data.unexpectedQueryCount, 100);
  if (data.issues) row.issues = data.issues.slice(0, 8).map(issue => ({ code: issueCodes.has(issue.code) ? issue.code : 'other', field: fields.has(issue.path?.[0]) ? issue.path[0] : 'other' }));
  if (data.error) {
    row.errorType = names.has(data.error.name) ? data.error.name : 'Error';
    row.frames = [...String(data.error.stack || '').matchAll(/(?:server|api|shared)\/([\w-]+\.mjs):(\d+):(\d+)/g)].slice(0, 5).map(match => `${match[1]}:${match[2]}:${match[3]}`);
  }
  if (CLIENT_EVENTS.includes(data.clientEvent)) row.clientEvent = data.clientEvent;
  if (data.clientLocation) {
    const location = data.clientLocation;
    if (/^index-[A-Za-z0-9_-]+\.js$/.test(location.asset || '')) row.asset = location.asset;
    for (const key of ['line', 'column']) if (Number.isInteger(location[key]) && location[key] >= 0 && location[key] <= 10000000) row[key] = location[key];
    if (ERROR_TYPES.includes(location.errorType)) row.errorType = location.errorType;
  }
  const level = event === 'request_completed' ? 'info' : (data.status >= 400 && data.status < 500) || event === 'validation_failed' ? 'warn' : 'error';
  console[level](JSON.stringify({ ...row, level }));
  return row;
}
