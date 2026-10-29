import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJson, startServer } from '../server/index.mjs';
import { Profile, recommend } from '../server/domain.mjs';
import { extractProfile } from '../shared/profile.mjs';

const fixture = { id: 'fixture', title: '지원', category: 'housing', topics: ['housing'], target: '전국민', criteria: '', checks: ['공식 조건'], agency: '기관', conditions: { JA0110: 18, JA0111: 39 } };

test('한국어와 이모지는 모든 UTF-8 청크 분할에서 보존되고 실제 바이트 수를 제한한다', async () => {
  const input = { text: '출산 지원 🏠', mode: 'demo' }, bytes = Buffer.from(JSON.stringify(input));
  for (let i = 1; i < bytes.length; i++) {
    const req = Readable.from([bytes.subarray(0, i), bytes.subarray(i)]); req.headers = { 'content-type': 'application/json' };
    assert.deepEqual(await readJson(req), input);
  }
  const req = Readable.from([Buffer.alloc(16385, 32)]); req.headers = { 'content-type': 'application/json' };
  await assert.rejects(readJson(req), { status: 413 });
  const invalid = Readable.from([Buffer.from([0xff])]); invalid.headers = { 'content-type': 'application/json' };
  await assert.rejects(readJson(invalid), { status: 400 });
});

test('기관 소재지가 다른 전국민 제도를 거주지역만으로 제거하지 않는다', async () => {
  const data = JSON.parse(await readFile(new URL('../data/benefits.json', import.meta.url), 'utf8'));
  const item = data.items.find(x => x.id === 'gov24-461000000106');
  assert.equal(item.target, '○ 전국민');
  assert.equal(recommend([item], [], Profile.parse({ age: 25, region: '서울' })).length, 1);
});

test('과거·부정·변경·충돌 조건은 현재 값으로 채우지 않으며 명확한 값은 보존한다', () => {
  const past = extractProfile('작년에 24살이었어요. 서울에 살지 않아요. 월세 지원이 필요해요');
  assert.equal(past.age, null); assert.equal(past.region, 'unknown');
  assert.equal(extractProfile('가구 월소득 0원에서 300만원으로 올랐어요').householdIncome, null);
  assert.equal(extractProfile('가구 월소득 100만원, 가구 월소득 200만원').householdIncome, null);
  assert.equal(extractProfile('나이는 25세가 아니에요').age, null);
  assert.equal(extractProfile('70세 아버지와 80세 어머니의 혜택을 찾습니다').age, null);
  assert.equal(extractProfile('아버지는 70세가 아니에요. 아버지 혜택을 찾아요').age, null);
  const known = extractProfile('만 25세 서울에 살아요. 가구 월소득 0원, 예금 500만원입니다.');
  assert.equal(known.age, 25); assert.equal(known.region, '서울'); assert.equal(known.householdIncome, 0); assert.equal(known.financialAssets, 5000000);
});

test('다른 지역 주민 전용 후보는 추천에서 제외하고 전국민 제도는 보존한다', () => {
  const local = { ...fixture, region: '부산', target: '지역 주민 모두' };
  const current = Profile.parse({ age: 25, region: '서울' });
  const results = recommend([local], [], current);
  assert.equal(results.length, 0);
  assert.equal(recommend([{ ...local, target: '전국민' }], [], current)[0].group, 'matched');
});

test('저장된 후보를 현재 조건으로 재평가하고 과거 미확인 조건을 누적하지 않는다', () => {
  const saved = recommend([fixture], [], Profile.parse({}));
  assert.ok(saved[0].checks.includes('지원받을 분의 정확한 나이'));
  const current = recommend(saved, [], Profile.parse({ age: 25, region: '서울' }));
  assert.equal(current[0].group, 'matched'); assert.ok(!current[0].checks.includes('지원받을 분의 정확한 나이'));
  assert.equal(recommend(current, [], Profile.parse({ age: 70, region: '서울' }))[0].group, 'outside');
});

test('미존재 API 5000개는 정상 경로 제한을 소진하지 않으며 분야 필터는 페이지 계산 전에 적용된다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'onhye-routing-'));
  const running = await startServer({ port: 0, frontend: false, guardFile: path.join(dir, 'guard.sqlite') });
  const base = `http://127.0.0.1:${running.server.address().port}`;
  try {
    for (let i = 0; i < 5000; i += 40) {
      const responses = await Promise.all(Array.from({ length: 40 }, (_, j) => fetch(base + '/api/missing-' + (i + j), { method: 'POST' }).then(async r => { await r.text(); return r.status; })));
      assert.ok(responses.every(status => status === 404));
    }
    assert.equal((await fetch(base + '/api/catalog')).status, 200);
    const body = { topics: ['housing', 'education'], profile: Profile.parse({ age: 25, region: '서울' }), resultTopic: 'housing' };
    const post = page => fetch(base + '/api/recommend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, page }) });
    const response = await post(1); assert.equal(response.status, 200); const first = await response.json();
    assert.ok(first.total > 30); assert.ok(first.items.every(x => x.topics.includes('housing')));
    const next = await (await post(2)).json(); assert.equal(next.total, first.total); assert.ok(next.items.every(x => x.topics.includes('housing'))); assert.ok(next.items.every(x => !first.items.some(y => y.id === x.id)));
  } finally { await new Promise(resolve => running.server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('개발 정적 제공은 private·DB 보조파일·절대 경로·심볼릭 링크를 차단한다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'onhye-static-')), originalCwd = process.cwd(), old = process.env.NODE_ENV;
  let running;
  try {
    process.chdir(dir); process.env.NODE_ENV = '';
    const file = path.join(dir, '.private', 'guard.sqlite');
    running = await startServer({ port: 0, guardFile: file });
    await writeFile(file + '-wal', 'private fixture');
    await symlink(file, path.join(dir, 'public-copy.bin'));
    await writeFile(path.join(dir, 'public.js'), 'export const ok = true;');
    const base = `http://127.0.0.1:${running.server.address().port}`;
    for (const name of ['/.private/guard.sqlite', '/%2eprivate/guard.sqlite?raw', '/.private/guard.sqlite-wal', '/@fs' + file, '/public-copy.bin?raw']) {
      const response = await fetch(base + name); assert.ok([403, 404].includes(response.status), name + ' exposed: ' + response.status); await response.text();
    }
    assert.equal((await fetch(base + '/public.js')).status, 200);
  } finally { if (running) { await new Promise(resolve => running.server.close(resolve)); await running.vite?.close(); } process.chdir(originalCwd); process.env.NODE_ENV = old || ''; await rm(dir, { recursive: true, force: true }); }
});
