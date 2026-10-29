import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreGuard } from '../server/firestore-guard.mjs';

test('공유 호출 한도는 인스턴스 간 원자적으로 예약되고 원문을 저장하지 않는다', async () => {
  let document, version = 0;
  const client = { request: async ({ method = 'GET', data }) => {
    if (method === 'GET') { if (!document) throw { response: { status: 404 } }; return { data: structuredClone(document) }; }
    const write = data.writes[0];
    if (write.currentDocument.updateTime !== document?.updateTime || (write.currentDocument.exists === false && document)) throw { response: { status: 409 } };
    document = { ...write.update, updateTime: String(++version) }; return { data: {} };
  } };
  let clock = Date.UTC(2026, 9, 28);
  const options = { project: 'test', secret: 'a'.repeat(64), client, now: () => clock };
  const a = createFirestoreGuard(options), b = createFirestoreGuard(options);
  const reservations = await Promise.allSettled([a.admit('actor', 'ip', 'request-1', '월세 부담'), b.admit('actor', 'ip', 'request-2', '월세 부담')]);
  assert.equal(reservations.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(reservations.find(r => r.status === 'rejected').reason.status, 429);
  const id = reservations.find(r => r.status === 'fulfilled').value;
  await b.finish(id);
  for (let i = 2; i <= 10; i++) { clock += 61000; await a.finish(await b.admit('actor', 'ip', 'request-' + i + '-new', '월세 부담')); }
  await assert.rejects(a.admit('actor', 'ip', 'request-11', '월세 부담'), { status: 429 });
  assert.equal(JSON.stringify(document).includes('월세 부담'), false);
  clock += 86400000; await a.pause(true);
  await assert.rejects(b.admit('fresh', 'fresh', 'pause-test', '상황'), { status: 503 });
  await b.pause(false);
  for (let i = 0; i < 100; i++) { clock += 61000; await a.finish(await b.admit('actor-' + i, 'ip-' + i, 'global-' + i, '상황')); }
  await assert.rejects(a.admit('over', 'over', 'global-over', '상황'), { status: 429 });
  const session = a.session(''); assert.equal(b.session('onhye_session=' + session.cookie).existing, true);
});

test('공유 저장소 설정이 없으면 로컬 DB로 대체하지 않고 무료 검색만 유지한다', async () => {
  const { startServer } = await import('../server/index.mjs');
  const { mkdtemp, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(tmpdir() + '/onhye-no-fallback-');
  const oldNode = process.env.NODE_ENV, oldOrigin = process.env.PUBLIC_ORIGIN;
  process.env.NODE_ENV = 'production'; process.env.PUBLIC_ORIGIN = 'https://example.com';
  let app;
  try {
    app = await startServer({ port: 0, frontend: false, guard: null, guardFile: dir + '/must-not-exist.sqlite', botCheck: async () => {}, ai: { project: 'test', billingConfirmed: true } });
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(status.geminiAvailable, false);
    assert.equal((await fetch(base + '/api/catalog-meta')).status, 200);
    await assert.rejects(access(dir + '/must-not-exist.sqlite'));
  } finally {
    if (app) await new Promise(resolve => app.server.close(resolve));
    process.env.NODE_ENV = oldNode || '';
    if (oldOrigin === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = oldOrigin;
    await rm(dir, { recursive: true, force: true });
  }
});
