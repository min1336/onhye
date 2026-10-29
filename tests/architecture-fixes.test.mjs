import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Profile, RecommendInput, topicKeys } from '../server/domain.mjs';
import { evaluateEligibility } from '../server/eligibility.mjs';
import { evaluateRegion } from '../shared/region.mjs';
import { programGuide } from '../server/program-guides.mjs';
import { createFirestoreGuard } from '../server/firestore-guard.mjs';
import { startServer } from '../server/index.mjs';
import { acquireMonitorLock, writeMonitorState } from '../scripts/monitor-state.mjs';

const profile = Profile.parse({ age: 35, childAge: 2, region: '경기', district: '화성시' });
test('실제 보육료·예방접종은 보호자 대신 아동 나이로 비교하고 미입력은 확인 대상으로 둔다', async () => {
  const { items } = JSON.parse(await readFile(new URL('../data/benefits.json', import.meta.url)));
  for (const title of ['영유아보육료 지원', '12세 이하 어린이 국가예방접종사업']) {
    const item = items.find(x => x.title === title); assert.ok(item);
    const guide = programGuide(item); if (guide) item.programGuide = guide;
    assert.equal(evaluateEligibility(item, profile).outside.length, 0);
    const unknown = evaluateEligibility(item, { ...profile, childAge: null });
    assert.equal(unknown.outside.length, 0); assert.ok(unknown.missing.includes('지원받을 아이의 만 나이'));
    assert.ok(evaluateEligibility(item, { ...profile, childAge: 17 }).outside.length > 0);
  }
});
test('관심 분야와 충돌하는 결과 탭은 거절하고 전체 탐색은 허용한다', () => {
  assert.equal(RecommendInput.safeParse({ topics: ['employment'], resultTopic: 'housing', profile }).success, false);
  assert.equal(RecommendInput.safeParse({ topics: [], resultTopic: 'housing', profile }).success, true);
  assert.equal(RecommendInput.safeParse({ topics: ['housing'], resultTopic: 'housing', profile }).success, true);
});
test('기업 소재지는 대표자 거주지로 제외하지 않고 별도 사업장 정보를 비교한다', () => {
  const item = { title: '기업 지원', target: '대구 소재 기업', agency: '지원센터', checks: ['공식 지원지역: 대구'] };
  assert.equal(evaluateRegion(item, profile).excluded, false);
  assert.ok(evaluateRegion(item, profile).missing.some(x => x.includes('사업장')));
  assert.equal(evaluateRegion(item, { ...profile, businessRegion: '대구' }).excluded, false);
  assert.equal(evaluateRegion(item, { ...profile, businessRegion: '경기' }).excluded, true);
});
function firestore() {
  const documents = new Map(); let version = 0;
  return { documents, client: { request: async ({ url, method = 'GET', data }) => {
    if (method === 'GET') { const document = documents.get(url.replace('https://firestore.googleapis.com/v1/', '')); if (!document) throw { response: { status: 404 } }; return { data: structuredClone(document) }; }
    const write = data.writes[0], previous = documents.get(write.update.name);
    if (write.currentDocument.updateTime !== previous?.updateTime || (write.currentDocument.exists === false && previous)) throw { response: { status: 409 } };
    documents.set(write.update.name, { ...write.update, updateTime: String(++version) }); return { data: {} };
  } } };
}
test('무료 검색 제한은 다른 인스턴스에서도 공유되며 IP 원문을 저장하지 않는다', async () => {
  const { client, documents } = firestore(); let clock = 60000;
  const options = { project: 'test', secret: 'a'.repeat(64), client, now: () => clock };
  const a = createFirestoreGuard(options), b = createFirestoreGuard(options);
  for (let i = 0; i < 60; i++) await (i % 2 ? a : b).rateLimit('private-ip', '/api/recommend');
  await assert.rejects(b.rateLimit('private-ip', '/api/recommend'), { status: 429 });
  assert.equal(JSON.stringify([...documents]).includes('private-ip'), false);
  assert.ok([...documents.values()][0].fields.expiresAt.timestampValue);
  clock += 60000; await b.rateLimit('private-ip', '/api/recommend');
});
test('완료 기록 실패가 성공한 AI 결과나 원래 제공자 오류를 덮어쓰지 않는다', async () => {
  let failProvider = false, calls = 0;
  const guard = { close() {}, session: () => ({ existing: true, actor: 'test' }), verify() {}, admit: () => 'ticket', finish: () => { throw Error('store down'); } };
  const generate = async () => { calls++; if (failProvider) throw { status: 429 }; return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ answers: Object.fromEntries(topicKeys.map(key => [key, { choice: 'absent', evidence: null }])) }) }] } }] }; };
  const app = await startServer({ port: 0, frontend: false, guard, ai: { project: 'test', billingConfirmed: true, generate } });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const request = () => fetch(origin + '/api/analyze', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-request-id': 'request-audit-123' }, body: JSON.stringify({ text: '취업 지원이 필요해요', mode: 'gemini', consent: true }) });
    assert.equal((await request()).status, 200);
    failProvider = true; assert.equal((await request()).status, 502); assert.equal(calls, 2);
  } finally { await new Promise(resolve => app.server.close(resolve)); }
});
test('모니터 잠금은 중복 실행을 차단하고 해제 후 실행 가능하며 상태는 완전한 JSON이다', async () => {
  const dir = await mkdtemp(tmpdir() + '/onhye-monitor-'), url = new URL('file://' + dir + '/');
  try {
    const attempts = await Promise.all([acquireMonitorLock(url), acquireMonitorLock(url)]);
    assert.equal(attempts.filter(Boolean).length, 1);
    await writeMonitorState(url, { healthy: true }); assert.deepEqual(JSON.parse(await readFile(new URL('latest.json', url))), { healthy: true });
    await attempts.find(Boolean)(); const release = await acquireMonitorLock(url); assert.ok(release); await release();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('배포 패키지는 원본 변경·압축본 변조·목록 변조를 검출한다', async () => {
  const dir = await mkdtemp(tmpdir() + '/onhye-pack-'); const run = promisify(execFile);
  const env = { ...process.env }; delete env.VERCEL;
  try {
    await mkdir(dir + '/scripts'); await mkdir(dir + '/data/channels', { recursive: true });
    await copyFile(new URL('../scripts/pack-deployment.mjs', import.meta.url), dir + '/scripts/pack-deployment.mjs');
    for (const name of ['benefits', 'announcements', 'channels']) await writeFile(`${dir}/data/${name}.json`, '{}');
    const execute = (...args) => run(process.execPath, [dir + '/scripts/pack-deployment.mjs', ...args], { env });
    await execute(); await execute('--verify');
    await writeFile(dir + '/data/benefits.json', '{"changed":true}'); await assert.rejects(execute('--verify'));
    await execute(); await writeFile(dir + '/.deploy-data/benefits.json.gz', 'invalid'); await assert.rejects(execute('--verify'));
    await execute(); await writeFile(dir + '/.deploy-data/channels-manifest.json', '["missing.json"]'); await assert.rejects(execute('--verify'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
