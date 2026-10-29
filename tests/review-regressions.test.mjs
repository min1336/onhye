import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractProfile, redactMoney } from '../shared/profile.mjs';
import { Profile, recommend } from '../server/domain.mjs';
import { analyze, startServer } from '../server/index.mjs';
import { evaluateEligibility } from '../server/eligibility.mjs';
const data = JSON.parse(await readFile(new URL('../data/benefits.json', import.meta.url), 'utf8'));

test('복수 인물·과거 거주·부정문에서 잘못된 값을 확정하지 않는다', () => {
  const family = extractProfile('저는 25세이고 70세 아버지의 혜택을 찾습니다.');
  assert.equal(family.subject, 'family'); assert.equal(family.age, 70); assert.equal(family.employment, 'unknown');
  assert.equal(extractProfile('서울에서 살다가 부산으로 이사했어요. 25세입니다.').region, 'unknown');
  assert.equal(extractProfile('저는 25세이고 아버지 혜택을 찾습니다.').age, null);
  assert.equal(extractProfile('취업을 준비합니다.').employment, 'seeking');
  assert.equal(extractProfile('무직은 아니고 재직 중입니다.').employment, 'employed');
  assert.ok(extractProfile('무주택이고 소득이 없어요.').special.includes('JA0412'));
  assert.equal(extractProfile('남성이 아니고 여성입니다.').sex, 'female');
});

test('수급자 전용 제도는 모르는 경우 필수정보 부족, 해당 없으면 불일치', () => {
  const item = data.items.find(i => i.title === '저소득시민 부가급여 지원');
  const profile = Profile.parse({ age: 25, region: '서울', sex: 'male', employment: 'seeking', special: ['JA0404', 'JA0412'] });
  const a = evaluateEligibility(item, profile), b = evaluateEligibility(item, { ...profile, recipient: 'none' });
  assert.equal(a.group, 'unknown'); assert.ok(a.missing.some(x => x.includes('수급')));
  assert.equal(b.group, 'outside');
  assert.equal(a.matched.some(x => x.includes('성별')), false);
});

test('같은 산정 기준의 가구 금액만 비교하며 0·경계·초과·연도 범위를 구분', () => {
  const item = data.items.find(i => i.id === 'gov24-611000000149');
  const p = Profile.parse({ age: 25, region: '서울', householdSize: 1, amountsAssessed: true, householdIncome: 0, householdFinancialAssets: 0 });
  const low = evaluateEligibility(item, p);
  assert.equal(low.outside.length, 0); assert.ok(low.matched.some(x => x.includes('금융재산')));
  const exact = evaluateEligibility(item, { ...p, householdFinancialAssets: 12564000 }); assert.equal(exact.outside.length, 0);
  const high = evaluateEligibility(item, { ...p, householdFinancialAssets: 12564001 }); assert.equal(high.group, 'outside');
  assert.equal(evaluateEligibility(item, { ...p, householdIncome: 2564239 }).group, 'outside');
  assert.equal(evaluateEligibility(item, { ...p, amountsAssessed: false, householdFinancialAssets: 1e11 }).outside.length, 0);
  assert.equal(evaluateEligibility(item, { ...p, householdSize: 2, householdFinancialAssets: 1e11 }).outside.length, 0);
  assert.equal(evaluateEligibility(item, Profile.parse({ financialAssets: 1e11 })).outside.length, 0);
  assert.equal(evaluateEligibility(item, { ...p, householdFinancialAssets: 1e11 }, '2027-01-01').outside.length, 0);
  const other = { ...item, id: 'unverified', title: '조건 미검증 제도', target: '', conditions: {}, criteria: '', checks: [], agency: '', region: null };
  assert.ok(recommend([item, other], [], p).findIndex(x => x.id === item.id) < recommend([item, other], [], { ...p, householdFinancialAssets: 1e11 }).findIndex(x => x.id === item.id));
});

test('AI 관심 분야는 전체 탐색을 유지하면서 실제 순서를 바꾼다', () => {
  const item = { checks: [], conditions: { JA0110: 0, JA0111: 120 }, target: '', agency: '기관', agencyType: '중앙행정기관' };
  const items = [{ ...item, id: 'housing', title: '주거', topics: ['housing'] }, { ...item, id: 'employment', title: '취업', topics: ['employment'] }];
  const p = Profile.parse({ age: 25, region: '서울' });
  const result = recommend(items, [], p, ['employment']);
  assert.equal(result.length, 2); assert.equal(result[0].id, 'employment'); assert.ok(result[0].reason.includes('대화'));
});

test('금액 축약·소수 표현을 가리며 서버도 AI 전송 전에 가린다', async () => {
  for (const text of ['예금 500만원', '예금 500만 있어요', '재산 1.5억원']) assert.ok(!redactMoney(text).match(/\d/));
  let sent;
  await analyze({ text: '예금 500만 있고 취업 지원 원해요', mode: 'gemini', consent: true }, { project: 'test', billingConfirmed: true, generate: async ({ payload }) => { sent = JSON.stringify(payload); return {}; } }).catch(() => {});
  assert.equal(sent.includes('500'), false);
});

test('목록과 초기 메타데이터는 작고 검색·페이징·입력검증이 동작한다', async () => {
  const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const { server } = await startServer({ port: 0 }); process.env.NODE_ENV = old || '';
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const raw = await (await fetch(base + '/api/catalog-meta')).text(), meta = JSON.parse(raw);
    assert.ok(Buffer.byteLength(raw) < 20000); assert.equal(meta.items, undefined); assert.equal(meta.count, 41388 + meta.additionalCount); assert.equal(meta.additionalCount, meta.channelCoverage.reduce((sum, source) => sum + source.imported, 0)); assert.equal(meta.announcementCoverage.accepting, 210);
    const first = await (await fetch(base + '/api/catalog')).json(); assert.equal(first.items.length, 20);
    assert.ok(Buffer.byteLength(JSON.stringify(first)) < 100000);
    const second = await (await fetch(base + '/api/catalog?page=2')).json(); assert.ok(second.items.every(x => !first.items.some(y => y.id === x.id)));
    const search = await (await fetch(base + '/api/catalog?q=' + encodeURIComponent('청년 월세'))).json(); assert.ok(search.total > 0); assert.ok(search.items.every(x => (x.title + x.summary + x.agency).includes('청년')));
    assert.equal((await fetch(base + '/api/catalog?page=-1')).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('선택 분야의 직접 관련 후보가 범용 조건 일치보다 앞서고 불일치 후보는 뒤에 온다', () => {
  const base = { checks: [], conditions: { JA0110: 0, JA0111: 120 }, target: '전국민', criteria: '', agency: '기관', topics: ['family'], popularity: 100 };
  const items = [
    { ...base, id: 'general', title: '독립기념관 온라인 연수서비스', summary: '독립운동사 교육 제공' },
    { ...base, id: 'birth', title: '출산 지원금', summary: '출산 가정 지원', target: '출산 가정', popularity: 0 },
    { ...base, id: 'matchedBirth', title: '출산 지원', summary: '도움 제공', popularity: 0 },
    { ...base, id: 'outside', title: '출산 지원', summary: '출산 가정 지원', conditions: { JA0110: 60, JA0111: 80 } },
  ];
  const result = recommend(items, ['family'], Profile.parse({ age: 25, region: '서울' }));
  assert.deepEqual(result.map(item => item.id), ['matchedBirth', 'birth', 'general', 'outside']);
  assert.equal(result[0].group, 'matched'); assert.equal(result[1].group, 'unknown'); assert.equal(result[2].group, 'matched');
});
