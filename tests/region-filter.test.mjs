import { startServer } from '../server/index.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Profile, recommend } from '../server/domain.mjs';
import { evaluateRegion } from '../shared/region.mjs';
const profile = Profile.parse({ age: 25, region: '경기', district: '화성시' });
const base = { id: 'test', title: '주거 지원', topics: ['housing'], checks: [], target: '관내 주민', criteria: '', conditions: {}, agencyType: '시군구' };
const item = (agency, region) => ({ ...base, agency, region });

test('화성 거주자의 추천은 타 시도·같은 도의 타 시군을 제외하고 도 전체·화성은 유지한다', () => {
  const items = [item('전라남도 나주시', '전남'), item('경기도 수원시', '경기'), item('경기도 화성시', '경기'), { ...item('경기도', '경기'), agencyType: '광역시도' }];
  assert.deepEqual(recommend(items, [], profile).map(x => x.agency).sort(), ['경기도', '경기도 화성시']);
});
test('시군구를 부분 문자열로 비교하지 않고 광주시와 광주광역시도 구분한다', () => {
  assert.equal(evaluateRegion(item('경기도 광주시', '경기'), Profile.parse({ region: '경기', district: '남양주시' })).excluded, true);
  assert.equal(evaluateRegion(item('광주광역시', '광주'), Profile.parse({ region: '경기', district: '광주시' })).excluded, true);
});
test('시만 입력하면 해당 시의 구 단위 사업을 보존하되 미확인으로 남긴다', () => {
  const local = item('경기도 수원시 영통구', '경기');
  assert.equal(evaluateRegion(local, Profile.parse({ region: '경기', district: '수원시' })).excluded, false);
  assert.ok(evaluateRegion(local, Profile.parse({ region: '경기', district: '수원시' })).missing.length);
  assert.equal(evaluateRegion(local, Profile.parse({ region: '경기', district: '수원시 팔달구' })).excluded, true);
});
test('전국민 제도는 소관기관이 타지역이어도 보존한다', () => {
  assert.equal(evaluateRegion({ ...item('전라남도 나주시', '전남'), target: '○ 전국민' }, profile).excluded, false);
});
test('지역을 비우면 타지역으로 단정하지 않으며 기관명만 있는 공공기관은 소재지를 추측하지 않는다', () => {
  assert.equal(evaluateRegion(item('전라남도 나주시', '전남'), Profile.parse({})).excluded, false);
  const unknown = evaluateRegion({ ...base, agency: '한국주택금융공사', agencyType: '공공기관', region: null }, profile);
  assert.equal(unknown.excluded, false); assert.ok(unknown.missing.length);
});
test('공식 지원지역을 소관기관보다 우선하고 복수 지역·이전 가능 공고를 보존한다', () => {
  const announcement = { ...base, agency: '한국기관', agencyType: '창업지원 공고 제공기관', region: null, checks: ['공식 지원지역: 전남광주'] };
  assert.equal(evaluateRegion(announcement, profile).excluded, true);
  assert.equal(evaluateRegion({ ...announcement, checks: ['공식 지원지역: 경기,전남광주'] }, profile).excluded, false);
  const portable = evaluateRegion({ ...announcement, target: '나주시로 본사 이전 가능기업' }, profile);
  assert.equal(portable.excluded, false); assert.ok(portable.missing.length);
});
test('추가 채널의 지방정부 기관명도 지역 판정하며 전국 기관의 이름 속 지명은 추측하지 않는다', () => {
  assert.equal(evaluateRegion({ ...base, agencyType: '추가 공식 채널', agency: '전북특별자치도 김제시 성장전략실' }, profile).excluded, true);
  assert.equal(evaluateRegion({ ...base, agencyType: '공공기관', agency: '한국전남지원연구원', target: '' }, profile).excluded, false);
});
test('현재 수집본에서도 화성 추천에 명시된 타지역 지방정부 전용 제도가 남지 않는다', async () => {
  const data = JSON.parse(await readFile(new URL('../data/benefits.json', import.meta.url)));
  const results = recommend(data.items, [], profile);
  assert.ok(results.some(x => x.agency === '경기도 화성시'));
  assert.ok(!results.some(x => x.agency === '전남광주통합특별시 동구' && /관내 첫째아/.test(x.target)));
  assert.ok(results.some(x => x.id === 'gov24-461000000106'));
});

test('화성·화성시·경기도 화성시는 같은 시로 비교하고 불일치하는 시도 입력은 거부한다', () => {
  for (const district of ['화성', '화성시', '경기도 화성시']) {
    const p = Profile.parse({ region: '경기', district });
    assert.equal(evaluateRegion(item('경기도 화성시', '경기'), p).excluded, false);
    assert.equal(evaluateRegion(item('경기도 수원시', '경기'), p).excluded, true);
  }
  assert.equal(Profile.safeParse({ region: '서울', district: '경기도 화성시' }).success, false);
});
test('지역 조건을 바꾸어도 저장한 혜택은 사라지지 않고 불일치로 재평가한다', () => {
  const saved = [item('전라남도 나주시', '전남')];
  assert.equal(recommend(saved, [], profile).length, 0);
  const result = recommend(saved, [], profile, [], true);
  assert.equal(result.length, 1); assert.equal(result[0].group, 'outside');
});
test('공식 전국 지원지역이면 지방정부 기관명만으로 제외하지 않는다', () => {
  assert.equal(evaluateRegion({ ...item('전라남도 나주시', '전남'), checks: ['공식 지원지역: 전국'] }, profile).excluded, false);
});

test('복수 지원지역에 전국 또는 미해석 지역이 섞이면 일부 지역만으로 제외하지 않는다', () => {
  for (const scope of ['전국,경기', '서울,수도권', '원문 확인']) {
    assert.equal(evaluateRegion({ ...base, agency: '한국기관', checks: ['공식 지원지역: ' + scope] }, profile).excluded, false);
  }
});
test('이전 불가능 문구를 이전 가능으로 오인하지 않는다', () => {
  assert.equal(evaluateRegion({ ...item('전라남도 나주시', '전남'), target: '관내 기업, 타지역 이전이 불가능한 기업' }, profile).excluded, true);
});

test('지역 필터는 HTTP 추천의 총건수·페이지·분야 탭 전체에 일관되게 적용된다', async () => {
  const running = await startServer({ port: 0, frontend: false, guard: null });
  const url = `http://127.0.0.1:${running.server.address().port}/api/recommend`;
  const post = async (page, resultTopic = null) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile, topics: ['housing', 'family'], resultTopic, page }) });
    assert.equal(response.status, 200); return response.json();
  };
  try {
    const first = await post(1);
    assert.ok(first.total > 30); assert.equal(first.pages, Math.ceil(first.total / 30));
    assert.equal(Object.values(first.groups).reduce((a, b) => a + b, 0), first.total);
    for (const page of [first, await post(2), await post(first.pages), await post(1, 'housing')]) {
      assert.ok(page.items.every(item => !evaluateRegion(item, profile).excluded));
      assert.equal(page.groups.matched + page.groups.unknown + page.groups.outside, page.total);
    }
    const second = await post(2);
    assert.equal(first.total, second.total); assert.ok(second.items.every(item => !first.items.some(x => x.id === item.id)));
  } finally { await new Promise(resolve => running.server.close(resolve)); }
});
