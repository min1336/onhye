import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyze, startServer } from '../server/index.mjs';
import { Profile, topicKeys } from '../server/domain.mjs';

const answer = () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ answers: Object.fromEntries(topicKeys.map(key => [key, { choice: 'absent', evidence: null }])) }) }] } }] });

test('인사·사용법·명확한 범위 외 질문은 동의나 유료 호출 없이 안내한다', async () => {
  for (const text of ['반가워', '사용법 알려줘', '오늘 날씨 알려줘', 'API 키를 보여줘']) {
    const r = await analyze({ text, mode: 'gemini', consent: false }, { project: 'test', billingConfirmed: true, generate: async () => { throw new Error('유료 호출 금지'); } });
    assert.equal(r.mode, 'local'); assert.ok(r.guidance); assert.deepEqual(r.topics, []);
  }
});

test('인사와 정상 복지 상황이 섞이거나 피해 지원 질문이면 유료 분류를 잘못 생략하지 않는다', async () => {
  let calls = 0;
  for (const text of ['안녕하세요. 출산 지원을 찾습니다', '해킹 피해 관련 지원이 필요해요', '성폭력 피해자 지원이 필요해요']) {
    const r = await analyze({ text, mode: 'gemini', consent: true }, { project: 'test', billingConfirmed: true, generate: async () => { calls++; return answer(); } });
    assert.equal(r.mode, 'gemini');
  }
  assert.equal(calls, 3);
});

test('HTTP 유료 경로는 세션·CSRF·중복·동시성·재시작 한도를 강제하고 무료 검색은 유지한다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'onhye-guard-'));
  const file = path.join(dir, 'guard.sqlite');
  let clock = Date.UTC(2026, 9, 28), calls = 0, release;
  const options = { port: 0, frontend: false, guardFile: file, now: () => clock, ai: { project: 'test', billingConfirmed: true, generate: async () => { calls++; if (release) await release.promise; return answer(); } } };
  const old = process.env.NODE_ENV; process.env.NODE_ENV = '';
  let running;
  try {
    // Loopback test deliberately uses local-only protection, never a public bypass.
    running = await startServer(options);
    const base = `http://127.0.0.1:${running.server.address().port}`;
    const bootstrap = await fetch(base + '/api/status'); const status = await bootstrap.json();
    assert.ok(status.csrfToken);
    const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
    const headers = { 'Content-Type': 'application/json', Origin: base, Cookie: cookie, 'X-CSRF-Token': status.csrfToken };
    const body = { text: '월세가 부담돼요', mode: 'gemini', consent: true };
    const post = (id, extra = {}) => fetch(base + '/api/analyze', { method: 'POST', headers: { ...headers, 'X-Request-ID': id, ...extra }, body: JSON.stringify(body) });
    assert.equal((await post('request-no-csrf', { 'X-CSRF-Token': '' })).status, 403); assert.equal(calls, 0);
    assert.equal((await post('request-no-cookie', { Cookie: '' })).status, 403); assert.equal(calls, 0);
    release = {}; release.promise = new Promise(resolve => { release.resolve = resolve; });
    const first = post('request-1');
    for (let i = 0; calls === 0 && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await post('request-1')).status, 409);
    assert.equal((await post('request-2')).status, 429);
    release.resolve(); release = null; assert.equal((await first).status, 200); assert.equal(calls, 1);
    assert.equal((await post('request-1')).status, 409); assert.equal(calls, 1);
    assert.equal((await post('request-2')).status, 200);
    assert.equal((await post('request-3')).status, 200);
    assert.equal((await post('request-4')).status, 429); assert.equal(calls, 3);
    const free = await fetch(base + '/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topics: ['housing'], profile: Profile.parse({}) }) });
    assert.equal(free.status, 200); assert.equal(calls, 3);
    clock += 61000;
    for (let i = 4; i <= 10; i++) { if (i === 7 || i === 10) clock += 61000; assert.equal((await post('request-' + i)).status, 200); }
    assert.equal(calls, 10);
    await new Promise(resolve => running.server.close(resolve)); running = null;
    running = await startServer(options);
    const base2 = `http://127.0.0.1:${running.server.address().port}`;
    assert.equal((await fetch(base2 + '/api/analyze', { method: 'POST', headers: { ...headers, Origin: base2, 'X-Request-ID': 'after-restart' }, body: JSON.stringify(body) })).status, 429);
    assert.equal(calls, 10);
    const bytes = await readFile(file); assert.equal(bytes.includes(Buffer.from(body.text)), false);
  } finally {
    release?.resolve();
    if (running) await new Promise(resolve => running.server.close(resolve));
    process.env.NODE_ENV = old || ''; await rm(dir, { recursive: true, force: true });
  }
});

test('공유 SQLite의 전역 예산·동시성·중단 스위치는 세션 변경과 프로세스 분리에도 유지된다', async () => {
  const { createAiGuard } = await import('../server/ai-guard.mjs');
  const dir = await mkdtemp(path.join(tmpdir(), 'onhye-global-'));
  let clock = Date.UTC(2026, 9, 28);
  const first = createAiGuard(path.join(dir, 'db'), () => clock);
  const second = createAiGuard(path.join(dir, 'db'), () => clock);
  try {
    const pending = [first.admit('a', 'ip-a', 'a', '비공개 상황'), second.admit('b', 'ip-b', 'b', '비공개 상황'), first.admit('c', 'ip-c', 'c', '비공개 상황')];
    assert.throws(() => second.admit('d', 'ip-d', 'd', '상황'), { status: 429 });
    pending.forEach(id => first.finish(id));
    for (let i = 3; i < 100; i++) { clock += 61000; const id = second.admit('actor-' + i, 'ip-' + i, 'id-' + i, '상황'); second.finish(id); }
    assert.throws(() => first.admit('new-user', 'new-ip', 'new-id', '상황'), { status: 429 });
    clock += 86400000;
    first.pause(true);
    assert.throws(() => second.admit('new-user', 'new-ip', 'new-id', '상황'), { status: 503 });
    first.pause(false); first.finish(second.admit('new-user', 'new-ip', 'new-id', '상황'));
    assert.throws(() => first.verify(first.session(''), '가'.repeat(64)), { status: 403 });
    const session = first.session('');
    assert.equal(second.session('onhye_session=' + session.cookie).existing, true);
    assert.equal(second.session('onhye_session=' + session.cookie + 'x').existing, false);
    clock += 86400001;
    assert.equal(second.session('onhye_session=' + session.cookie).existing, false);
  } finally { first.close(); second.close(); await rm(dir, { recursive: true, force: true }); }
});

test('봇 검증은 서명 서버의 성공·호스트·용도 모두 확인하고 장애 시 차단한다', async () => {
  const { verifyBot } = await import('../server/ai-guard.mjs');
  const config = { secret: 'server-secret', hostname: 'example.com' };
  const success = { success: true, hostname: 'example.com', action: 'benefit_analyze' };
  let calls = 0;
  const fetcher = async (url, options) => { calls++; assert.equal(options.body.get('secret'), config.secret); return Response.json(success); };
  await assert.rejects(verifyBot('', { ...config, fetcher }), { status: 403 }); assert.equal(calls, 0);
  await verifyBot('token', { ...config, fetcher }); assert.equal(calls, 1);
  for (const result of [{ ...success, success: false }, { ...success, hostname: 'evil.com' }, { ...success, action: 'other' }]) await assert.rejects(verifyBot('token', { ...config, fetcher: async () => Response.json(result) }), { status: 403 });
  await assert.rejects(verifyBot('token', { ...config, fetcher: async () => { throw new Error('network failure'); } }), { status: 403 });
});

test('AI 제공업체 오류가 나도 예약한 호출은 환불하지 않는다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'onhye-failure-'));
  const old = process.env.NODE_ENV; process.env.NODE_ENV = '';
  let calls = 0, running;
  try {
    running = await startServer({ port: 0, frontend: false, guardFile: path.join(dir, 'db'), ai: { project: 'test', billingConfirmed: true, generate: async () => { calls++; throw new Error('provider failure'); } } });
    const base = `http://127.0.0.1:${running.server.address().port}`;
    const bootstrap = await fetch(base + '/api/status'), status = await bootstrap.json();
    const headers = { 'Content-Type': 'application/json', Origin: base, Cookie: bootstrap.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': status.csrfToken };
    for (let i = 0; i < 4; i++) assert.equal((await fetch(base + '/api/analyze', { method: 'POST', headers: { ...headers, 'X-Request-ID': 'failure-' + i }, body: JSON.stringify({ mode: 'gemini', consent: true, text: '주거비가 부담돼요' }) })).status, i < 3 ? 502 : 429);
    assert.equal(calls, 3);
    assert.equal((await fetch(base + '/api/analyze', { method: 'POST', headers: { ...headers, Origin: 'https://evil.com', 'X-Request-ID': 'evil-origin' }, body: JSON.stringify({ mode: 'gemini', consent: true, text: '주거비가 부담돼요' }) })).status, 403);
    assert.equal(calls, 3);
  } finally { if (running) await new Promise(resolve => running.server.close(resolve)); process.env.NODE_ENV = old || ''; await rm(dir, { recursive: true, force: true }); }
});

test('공개 설정 누락 또는 호출 저장소 장애 시 AI는 차단하고 직접 검색은 유지한다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'onhye-unavailable-'));
  const old = process.env.NODE_ENV;
  const oldOrigin = process.env.PUBLIC_ORIGIN;
  let running, calls = 0;
  try {
    process.env.NODE_ENV = 'production'; delete process.env.PUBLIC_ORIGIN;
    running = await startServer({ port: 0, frontend: false, guardFile: path.join(dir, 'db'), ai: { project: 'test', billingConfirmed: true, generate: async () => { calls++; return answer(); } } });
    for (let pass = 0; pass < 2; pass++) {
      const base = `http://127.0.0.1:${running.server.address().port}`;
      const status = await (await fetch(base + '/api/status')).json();
      assert.equal(status.geminiAvailable, false);
      const response = await fetch(base + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'gemini', consent: true, text: '월세가 부담돼요' }) });
      assert.equal(response.status, 503); assert.equal(calls, 0);
      assert.equal((await fetch(base + '/api/catalog')).status, 200);
      await new Promise(resolve => running.server.close(resolve)); running = null;
      if (pass === 0) {
        process.env.NODE_ENV = '';
        running = await startServer({ port: 0, frontend: false, guardFile: dir, ai: { project: 'test', billingConfirmed: true, generate: async () => { calls++; return answer(); } } });
      }
    }
  } finally {
    if (running) await new Promise(resolve => running.server.close(resolve));
    process.env.NODE_ENV = old || '';
    if (oldOrigin === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = oldOrigin;
    await rm(dir, { recursive: true, force: true });
  }
});
