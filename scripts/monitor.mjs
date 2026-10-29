import { acquireMonitorLock, writeMonitorState } from './monitor-state.mjs';
import { readFile, appendFile, mkdir, stat, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeRoute } from '../shared/telemetry.mjs';
const run = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const directory = pathToFileURL(join(homedir(), 'Library/Application Support/OnhyeMonitor/state') + '/'), base = 'https://onhye.vercel.app';
if (process.argv.includes('--self-test')) {
  const { default: assert } = await import('node:assert/strict');
  const row = safeRuntimeLog({ id: 'test', requestPath: '/api/catalog?q=SECRET', responseStatusCode: 400, message: 'SECRET-INPUT', logs: [{ message: JSON.stringify({ app: 'onhye', event: 'request_failed', route: '/api/catalog?q=SECRET', message: 'SECRET-TOKEN', frames: ['index.mjs:1:2', 'SECRET-STACK'] }) }] });
  assert.equal(row.route, '/api/catalog'); assert.equal(row.events.length, 1);
  assert.ok(!JSON.stringify(row).includes('SECRET'));
  console.log('monitor log privacy self-test passed'); process.exit(0);
}
await mkdir(directory, { recursive: true, mode: 0o700 });
if (process.argv.includes('--status')) {
  const latest = JSON.parse(await readFile(new URL('latest.json', directory), 'utf8'));
  const stale = Date.now() - Date.parse(latest.checkedAt) > 15 * 60000;
  console.log(JSON.stringify({ ...latest, stale }, null, 2));
  process.exit(latest.healthy && !stale && latest.logAccess.every(row => row.ok && !row.limitReached) ? 0 : 1);
}
async function probe(path, options) {
  const start = performance.now();
  try {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(20000) });
    const body = await response.text();
    let valid = response.ok, count, aiAvailable, asset;
    if (path.startsWith('/api/')) {
      const data = JSON.parse(body);
      if (path.startsWith('/api/status')) { aiAvailable = data.geminiAvailable === true; count = data.count; valid &&= aiAvailable && count > 0; }
      else if (path.startsWith('/api/catalog?')) { count = data.total; valid &&= count > 0 && Array.isArray(data.items) && data.items.length > 0; }
      else if (path.startsWith('/api/recommend')) { count = data.total; valid &&= count > 0 && Array.isArray(data.items); }
    } else if (path.startsWith('/assets/')) valid &&= /javascript/.test(response.headers.get('content-type') || '');
    else { asset = body.match(/src="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/)?.[1]; valid &&= /<div id="root"/.test(body) && Boolean(asset); }
    return { path: path.split('?')[0], status: response.status, ok: valid, durationMs: Math.round(performance.now() - start), requestId: response.headers.get('x-request-id'), ...(asset ? { asset } : {}), ...(count !== undefined ? { count } : {}), ...(aiAvailable !== undefined ? { aiAvailable } : {}) };
  } catch { return { path: path.split('?')[0], ok: false, failure: 'network_or_response_invalid', durationMs: Math.round(performance.now() - start) }; }
}
function safeRuntimeLog(row) {
  return { id: typeof row.id === 'string' ? row.id.slice(0, 128) : null, timestamp: row.timestamp, route: safeRoute(row.requestPath), status: row.responseStatusCode, level: ['info', 'warning', 'error', 'fatal'].includes(row.level) ? row.level : 'unknown', deploymentId: /^dpl_[\w]+$/.test(row.deploymentId) ? row.deploymentId : null,
    events: (Array.isArray(row.logs) && row.logs.length ? row.logs : [row]).flatMap(entry => {
      try {
        const event = JSON.parse(entry.message);
        if (event.app !== 'onhye') return [];
        return [{ event: /^[a-z_]{1,40}$/.test(event.event) ? event.event : 'unknown', requestId: /^[a-f0-9-]{36}$/.test(event.requestId || '') ? event.requestId : null, route: safeRoute(event.route), status: Number.isInteger(event.status) ? event.status : null, upstreamStatus: Number.isInteger(event.upstreamStatus) ? event.upstreamStatus : null,
          ...(/^[a-z_]{1,40}$/.test(event.clientEvent || '') ? { clientEvent: event.clientEvent } : {}),
          ...(/^index-[A-Za-z0-9_-]+\.js$/.test(event.asset || '') ? { asset: event.asset, line: Number.isInteger(event.line) ? event.line : null, column: Number.isInteger(event.column) ? event.column : null } : {}),
          ...(typeof event.rewriteParameterPresent === 'boolean' ? { rewriteParameterPresent: event.rewriteParameterPresent } : {}),
          ...(Array.isArray(event.frames) ? { frames: event.frames.filter(frame => /^[\w-]+\.mjs:\d+:\d+$/.test(frame)).slice(0, 5) } : {}) }];
      } catch { return []; }
    }) };
}
const release = await acquireMonitorLock(directory);
if (!release) { console.log('monitor already running'); process.exit(0); }
try {
const checks = await Promise.all([
  probe('/'), probe('/api/status'), probe('/api/catalog?q=&topic=all&region=all&agency=all&page=1'),
  probe('/api/recommend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topics: ['housing'], profile: { age: 25, region: '경기', district: '화성시' }, page: 1 }) }),
]);
if (checks[0].asset) checks.push(await probe(checks[0].asset, { method: 'HEAD' }));
const previous = await readFile(new URL('latest.json', directory), 'utf8').then(JSON.parse).catch(() => null);
const windows = [['4xx', '--status-code', '4xx'], ['5xx', '--status-code', '5xx'], ['application', '--level', 'error']];
const collected = await Promise.all(windows.map(async ([name, flag, value]) => {
  try {
    const { stdout } = await run('vercel', ['logs', '--project', 'prj_HSrkuQRyxI44lR3XxiIHQaSt6IXR', '--no-branch', '--environment', 'production', '--since', '10m', '--limit', '100', flag, value, '--json', '--scope', 'aldursjrnf123-4009s-projects'], { cwd: root, timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
    const rows = stdout.split('\n').filter(Boolean).map(line => { try { return safeRuntimeLog(JSON.parse(line)); } catch { return null; } }).filter(Boolean);
    return { name, ok: true, limitReached: rows.length >= 100, rows };
  } catch { return { name, ok: false, failure: 'log_access_failed', rows: [] }; }
}));
const unique = [...new Map(collected.flatMap(result => result.rows).map(row => [row.id || JSON.stringify(row), row])).values()];
const recentIds = new Set(previous?.recentLogIds || []);
const fresh = unique.filter(row => !recentIds.has(row.id));
const result = { checkedAt: new Date().toISOString(), canonicalUrl: base, healthy: checks.every(check => check.ok), checks,
  logAccess: collected.map(({ rows, ...rest }) => ({ ...rest, count: rows.length })), recentErrors: unique.slice(0, 20), recentLogIds: unique.map(row => row.id),
  notice: 'Client-reported events are untrusted. AI availability is readiness only; no paid model probe. Bounded log queries may be incomplete.' };
async function appendBounded(filename, entries) {
  if (!entries.length) return;
  const url = new URL(filename, directory);
  if (await stat(url).then(s => s.size > 4 * 1024 * 1024).catch(() => false)) { await rm(new URL(filename + '.1', directory), { force: true }); await rename(url, new URL(filename + '.1', directory)); }
  await appendFile(url, entries.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
}
await appendBounded('checks.jsonl', [{ ...result, recentLogIds: undefined, recentErrors: undefined }]);
await appendBounded('errors.jsonl', fresh);
await writeMonitorState(directory, result);
console.log(JSON.stringify({ checkedAt: result.checkedAt, healthy: result.healthy, checks, logAccess: result.logAccess, newErrors: fresh.length }, null, 2));
process.exitCode = result.healthy && collected.every(result => result.ok && !result.limitReached) ? 0 : 1;

} finally { await release(); }
