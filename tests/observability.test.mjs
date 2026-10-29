import { errorLocation } from '../src/telemetry.mjs';
import { platformRequestUrl } from '../api/index.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { logEvent, newRequestId } from '../server/observability.mjs';
import { startServer } from '../server/index.mjs';
import { ClientEvent } from '../server/domain.mjs';

test('로그는 원문·URL·헤더·에러 메시지·외부 스택을 남기지 않는다', () => {
  const rows = [], previous = console.error; console.error = value => rows.push(value);
  try {
    const error = new Error('주민번호 SECRET-INPUT token SECRET-TOKEN');
    error.stack = 'Error: SECRET-INPUT\n at https://example.com/SECRET-TOKEN\n at /Users/name/server/index.mjs:123:4';
    logEvent('request_exception', { requestId: newRequestId(), route: '/api/catalog?q=SECRET-SEARCH', status: 500, error, body: 'SECRET-BODY', cookie: 'SECRET-COOKIE', clientEvent: 'SECRET-EVENT' });
    const output = rows.join(''); assert.ok(!output.includes('SECRET-')); assert.ok(!output.includes('/Users/name'));
    assert.deepEqual(JSON.parse(rows[0]).frames, ['index.mjs:123:4']);
    assert.equal(JSON.parse(rows[0]).route, '/api/catalog');
  } finally { console.error = previous; }
});
test('프런트 오류 수집은 정해진 코드·경로·요청ID만 허용한다', () => {
  assert.equal(ClientEvent.safeParse({ event: 'network_error', route: '/api/catalog' }).success, true);
  for (const extra of [{ message: '상담 원문' }, { stack: '주소' }, { event: 'arbitrary' }, { route: 'https://evil.example' }]) {
    assert.equal(ClientEvent.safeParse({ event: 'network_error', route: '/api/catalog', ...extra }).success, false);
  }
});
test('성공·검증실패·클라이언트 오류가 요청ID와 연결되며 오류 수집은 출처·횟수를 제한한다', async () => {
  const rows = [], originals = { log: console.info, warn: console.warn, error: console.error };
  console.info = console.warn = console.error = line => rows.push(JSON.parse(line));
  let running;
  try {
    running = await startServer({ port: 0, frontend: false, guard: null });
    const base = `http://127.0.0.1:${running.server.address().port}`;
    const normal = await fetch(base + '/api/catalog?q=SECRET-SEARCH'); assert.equal(normal.status, 200); await normal.json();
    const invalid = await fetch(base + '/api/catalog?page=bad&path=catalog'); assert.equal(invalid.status, 400); await invalid.json();
    const post = (body, origin = base) => fetch(base + '/api/client-events', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
    const body = { event: 'network_error', route: '/api/catalog', requestId: normal.headers.get('x-request-id') };
    assert.equal((await post(body)).status, 202);
    assert.equal((await post(body, 'https://evil.example')).status, 403);
    assert.equal((await post({ ...body, message: 'SECRET-BODY' })).status, 400);
    for (let i = 0; i < 8; i++) await post(body);
    assert.equal((await post(body)).status, 429);
    assert.ok(rows.some(row => row.event === 'request_completed' && row.requestId === body.requestId));
    assert.ok(rows.some(row => row.event === 'client_error' && row.requestId === body.requestId));
    assert.ok(rows.some(row => row.event === 'validation_failed' && row.rewriteParameterPresent));
    assert.ok(!JSON.stringify(rows).includes('SECRET-'));
  } finally { if (running) await new Promise(resolve => running.server.close(resolve)); console.info = originals.log; console.warn = originals.warn; console.error = originals.error; }
});

test('Vercel의 내부 경로 캡처만 제거하고 검색조건과 알 수 없는 입력의 검증을 보존한다', () => {
  assert.equal(platformRequestUrl('/api/catalog?path=catalog&page=2&q=청년'), '/api/catalog?page=2&q=%EC%B2%AD%EB%85%84');
  assert.equal(platformRequestUrl('/api/catalog?path=arbitrary'), '/api/catalog?path=arbitrary');
  assert.equal(platformRequestUrl('/api/catalog?path=catalog&path=extra'), '/api/catalog?path=catalog&path=extra');
  assert.equal(platformRequestUrl('/api/missing?path=missing'), '/api/missing?path=missing');
  assert.equal(platformRequestUrl('/api/catalog?unexpected=true'), '/api/catalog?unexpected=true');
});

test('브라우저 오류는 번들 파일·행·열만 추출하며 메시지나 외부 스택은 전송하지 않는다', () => {
  const error = { name: 'TypeError', stack: 'SECRET-DATA at https://onhye.vercel.app/assets/index-test.js:10:25' };
  const location = errorLocation(error);
  assert.deepEqual(location, { errorType: 'TypeError', asset: 'index-test.js', line: 10, column: 25 });
  assert.ok(!JSON.stringify(location).includes('SECRET'));
  assert.equal(ClientEvent.safeParse({ event: 'javascript_error', route: 'unknown', ...location }).success, true);
  assert.equal(ClientEvent.safeParse({ event: 'javascript_error', route: 'unknown', asset: 'secret/path.js' }).success, false);
});
