import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Profile } from '../server/domain.mjs';
import { programGuide } from '../server/program-guides.mjs';
import { recommend, shortlistRecommendations, isClosed, koreanDate } from '../shared/recommendation.mjs';
import { evaluateEligibility } from '../server/eligibility.mjs';
import { startServer } from '../server/index.mjs';
const source = JSON.parse(await readFile(new URL('../data/benefits.json', import.meta.url)));
const items = source.items.map(item => ({ ...item, programGuide: programGuide(item) }));
const profile = Profile.parse({ age: 25, region: '경기', district: '화성시', employment: 'seeking' });
const short = (p = profile, topics = []) => shortlistRecommendations(recommend(items, topics, p), topics, p);

test('구직자의 우선 후보는 지역화폐·관람보다 취업 지원을 앞세우고 최대5개를 유지한다', () => {
  const result = short();
  assert.ok(result.items.length > 0 && result.items.length <= 5);
  assert.ok(result.items.some(item => item.title === '국민취업지원제도'));
  assert.ok(result.items.every(item => !/지역화폐|생태체험|독립기념관/.test(item.title)));
  assert.ok(result.items.every(item => item.group !== 'outside' && !item.closed && !item.exception));
});
test('관심을 확인하지 못한 상태에서는 범용 혜택으로 우선 후보를 채우지 않는다', () => {
  const result = short(Profile.parse({}));
  assert.deepEqual(result.items, []); assert.equal(result.followUps[0].field, 'topics');
});
test('월세·전세보증금·구입 목적은 서로 다른 우선 후보를 만든다', () => {
  const rent = short(Profile.parse({ ...profile, housingGoal: 'rent' }), ['housing']);
  assert.ok(rent.items.some(item => item.title === '청년월세 지원'));
  assert.ok(!rent.items.some(item => item.title === '내집마련 디딤돌 대출' || item.title === '버팀목전세자금대출'));
  const deposit = short(Profile.parse({ ...profile, housingGoal: 'deposit' }), ['housing']);
  assert.ok(deposit.items.some(item => item.title === '버팀목전세자금대출'));
});
test('35세 부모와 2세 아동의 나이를 구분하며 미입력 아동 나이는 추정하지 않는다', () => {
  const item = items.find(item => item.title === '아동수당');
  assert.equal(evaluateEligibility(item, Profile.parse({ age: 35, childAge: 2, region: '경기' })).outside.length, 0);
  const unknown = evaluateEligibility(item, Profile.parse({ age: 35, region: '경기' }));
  assert.ok(unknown.missing.some(text => text.includes('아이'))); assert.equal(unknown.outside.length, 0);
  assert.ok(evaluateEligibility(item, Profile.parse({ age: 35, childAge: 8, region: '경기' })).outside.length);
});
test('출생아 대상과 구조화 연령이 혼재한 제도는 임의의 부모 연령으로 탈락시키지 않는다', () => {
  const item = items.find(item => item.title === '첫만남이용권 지원');
  assert.equal(evaluateEligibility(item, Profile.parse({ age: 70, region: '경기' })).group, 'unknown');
});
test('원문이 변경되면 사전정리한 안내를 적용하지 않는다', () => {
  const item = items.find(item => item.title === '국민취업지원제도');
  assert.ok(programGuide(item));
  assert.equal(programGuide({ ...item, criteria: item.criteria + ' 변경' }), null);
});
test('같은 국가장학금 유형은 우선 후보에서 중복을 줄이되 전체 후보에서 보존한다', () => {
  const p = Profile.parse({ age: 22, region: '서울', employment: 'student' });
  const all = recommend(items, ['education'], p), result = shortlistRecommendations(all, ['education'], p);
  assert.ok(all.filter(item => item.programGuide?.groupKey === 'national-scholarship').length >= 2);
  assert.equal(result.items.filter(item => item.programGuide?.groupKey === 'national-scholarship').length, 1);
});
test('확인된 재직 상태에 대학생 장학금을 우선하지 않는다', () => {
  const p = Profile.parse({ age: 25, region: '서울', employment: 'employed' });
  assert.ok(short(p, ['education']).items.every(item => item.programGuide?.employmentSignal !== 'student'));
});
test('마감 경과·전입 예외·공개 목록만 있는 후보를 우선 후보로 올리지 않는다', () => {
  const base = items.find(item => item.title === '국민취업지원제도');
  const supplied = [{ ...base, id: 'expired', endDate: '20200101', accepting: true }, { ...base, id: 'list-only', contentLevel: 'public-list' }, { ...base, id: 'relocation', region: '전남', agency: '전라남도 나주시', target: '나주시로 전입 예정인 주민' }];
  const all = recommend(supplied, ['employment'], profile);
  assert.equal(all.length, 3); assert.equal(shortlistRecommendations(all, ['employment'], profile).items.length, 0);
  assert.equal(isClosed({ endDate: '2026-10-28' }, '2026-10-29'), true);
});
test('부족한 정보를 질문하되 값이나 수급자격을 만들어내지 않는다', () => {
  const result = short(Profile.parse({ age: 25, region: '경기' }), ['housing']);
  assert.ok(result.followUps.some(question => question.field === 'housingGoal'));
  assert.ok(result.followUps.every(question => !['householdSize', 'incomeBracket'].includes(question.field)));
  assert.ok(result.items.every(item => item.group === 'unknown'));
  assert.equal(Profile.parse({ childAge: 0 }).childAge, 0);
  assert.equal(Profile.safeParse({ childAge: 18 }).success, false);
});
test('추가 확인 질문을 정리하지 않은 새 제도도 실제 관심과 관련되면 탐색할 수 있다', () => {
  const newItem = { id: 'new-program', title: '청년 구직 지원', summary: '취업 상담', category: 'employment', topics: ['employment'], target: '구직 청년', criteria: '', conditions: { JA0110: 19, JA0111: 39 }, checks: [], region: null, agency: '새 공식 기관' };
  const all = recommend([newItem], ['employment'], profile);
  assert.equal(shortlistRecommendations(all, ['employment'], profile).items[0].id, 'new-program');
});
test('페이지를 넘겨도 우선 후보와 확인 질문이 유지되고 모든 후보를 탐색할 수 있다', async () => {
  const running = await startServer({ port: 0, frontend: false, guard: null });
  try {
    const post = async page => (await fetch(`http://127.0.0.1:${running.server.address().port}/api/recommend`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topics: ['employment'], profile, page }) })).json();
    const first = await post(1), next = await post(2);
    assert.equal(first.total, next.total); assert.equal(first.items.length, 30);
    assert.deepEqual(first.shortlist, next.shortlist);
    assert.ok(first.shortlist.items.some(item => item.title === '국민취업지원제도'));
  } finally { await new Promise(resolve => running.server.close(resolve)); }
});

test('대학생 장학금과 고용보험 제도의 제공 연령표시를 절대 자격 제한으로 단정하지 않는다', () => {
  const scholarship = items.find(item => item.id === 'gov24-SD0000004508');
  assert.equal(evaluateEligibility(scholarship, Profile.parse({ age: 45, employment: 'student', region: '서울' })).outside.length, 0);
  const job = items.find(item => item.id === 'gov24-149200005007');
  assert.ok(evaluateEligibility(job, Profile.parse({ age: 70, region: '서울' })).outside.length > 0);
});

test('마감일은 서버 UTC가 아니라 한국 날짜로 비교한다', () => {
  const date = koreanDate(new Date('2026-10-28T15:01:00Z'));
  assert.equal(date, '2026-10-29');
  assert.equal(isClosed({ endDate: '20261028' }, date), true);
  assert.equal(isClosed({ endDate: '20261029' }, date), false);
});
