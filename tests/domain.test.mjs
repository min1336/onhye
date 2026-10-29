import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnalyzeInput, Profile, RecommendInput, demoClassify, makeQuestions, parseDecisions, recommend, topicKeys } from '../server/domain.mjs';
import { analyze, startServer } from '../server/index.mjs';
import { plainText, normalizeBenefit, syncCatalog } from '../server/welfare.mjs';

const catalog = JSON.parse(await readFile(new URL('./fixtures/benefits.seed.json', import.meta.url), 'utf8'));
const profile = Profile.parse({});
const answer = (choice, evidence = null) => ({ choice, evidence });
const response = () => ({ answers: Object.fromEntries(topicKeys.map(key => [key, answer('absent')])) });
const vertexResponse = raw => ({ modelVersion: 'gemini-3.5-flash-lite', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(raw) }] } }] });

test('복수 고민을 보존하며 미언급 분야를 덧붙이지 않는다', () => {
  assert.deepEqual(demoClassify('취업을 준비하고 월세가 부담돼요'), ['employment', 'housing']);
  assert.deepEqual(demoClassify('오늘 날씨가 궁금해요'), []);
});
test('체험 분류는 부정된 관심을 보류하고 사용자가 직접 고르게 한다', () => {
  assert.deepEqual(demoClassify('취업 지원은 필요 없어요. 월세가 부담돼요.'), ['housing']);
});
test('나이 0을 보존하고 미확인과 혼동하지 않는다', () => {
  assert.equal(Profile.parse({ age: 0 }).age, 0);
  for (const age of [-1, 121, 23.5, '25']) assert.equal(Profile.safeParse({ age }).success, false);
  assert.equal(profile.age, null);
});
test('입력 경계·모드·개인식별정보·추가 필드를 검증한다', () => {
  for (const text of ['', 'a', 'x'.repeat(2001), '전화는 010-1234-5678입니다', '주민번호 000101-3123456']) assert.equal(AnalyzeInput.safeParse({ text, mode: 'demo' }).success, false);
  assert.equal(AnalyzeInput.safeParse({ text: '취업준비', mode: 'demo', apiKey: 'fake' }).success, false);
  assert.equal(RecommendInput.safeParse({ topics: ['fake'], profile }).success, false);
});
test('소득·재산을 생성하지 않고 미확인 조건과 원문을 유지한다', () => {
  const results = recommend(catalog.items, ['housing'], profile);
  assert.equal(results.length, 1);
  assert.ok(results[0].checks.includes('지원받을 분의 정확한 나이'));
  assert.ok(results[0].checks.some(x => x.includes('소득')));
  assert.equal(results[0].status, '필수정보·조건 확인 필요');
  assert.equal(results[0].url, catalog.items.find(i => i.id === results[0].id).url);
});
test('가족 검색과 연금 연령 예외는 임의 탈락 없이 주의사항으로 보존한다', () => {
  assert.ok(recommend(catalog.items, ['senior'], { ...profile, age: 25, subject: 'family' })[0].notes.length);
  assert.equal(recommend(catalog.items, ['senior'], { ...profile, age: 65 })[0].notes.length, 0);
});
test('동일 분야 중복 입력이 추천을 복제하지 않는다', () => {
  assert.equal(recommend(catalog.items, ['housing', 'housing'], profile).length, 1);
});
test('각 구조화 질문은 독립적이며 선택지에 미확인을 포함한다', () => {
  const questions = makeQuestions();
  assert.deepEqual(Object.keys(questions), topicKeys);
  for (const q of Object.values(questions)) { assert.ok(q.criteria.unknown); assert.equal(q.type, 'choice'); }
});
test('근거 없는 관련성은 보류하며 복수 분야와 미확인을 보존한다', () => {
  const raw = response(); raw.answers.housing = answer('relevant'); raw.answers.family = answer('unknown'); raw.answers.employment = answer('relevant', '취업 준비');
  const result = parseDecisions(raw, '취업 준비 중이에요');
  assert.deepEqual(result.topics, ['employment']);
  assert.deepEqual(result.uncertain, ['housing', 'family']);
  assert.equal('probabilities' in result.answers.employment, false);
});
test('분류 누락·추가키·원문에 없는 근거·임의 확률을 거부한다', () => {
  const missing = response(); delete missing.answers.housing; assert.throws(() => parseDecisions(missing, '월세 부담'));
  const extra = response(); extra.answers.fake = answer('absent'); assert.throws(() => parseDecisions(extra, '월세 부담'));
  const invented = response(); invented.answers.housing = answer('relevant', '나는 무주택자'); assert.throws(() => parseDecisions(invented, '월세 부담'));
  const probability = response(); probability.answers.housing.confidence = 1; assert.throws(() => parseDecisions(probability, '월세 부담'));
});
test('프로젝트·후불 확인·전송 동의 없이는 Gemini를 호출하지 않는다', async () => {
  const generate = () => { throw new Error('should not call'); };
  await assert.rejects(analyze({ mode: 'gemini', text: '취업 준비', consent: true }, { generate }), { status: 503 });
  await assert.rejects(analyze({ mode: 'gemini', text: '취업 준비', consent: true }, { generate, project: 'test-project', billingConfirmed: false }), { status: 503 });
  await assert.rejects(analyze({ mode: 'gemini', text: '취업 준비', consent: false }, { generate, project: 'test-project', billingConfirmed: true }), { status: 400 });
});
test('체험 모드는 네트워크를 쓰지 않는다', async () => {
  const result = await analyze({ mode: 'demo', text: '월세가 부담돼요' }, { generate: () => { throw new Error('should not call'); } });
  assert.deepEqual(result.topics, ['housing']); assert.equal(result.mode, 'demo');
});
test('Gemini는 한 요청에 독립 질문·제한된 스키마를 보내고 원문 근거를 검증한다', async () => {
  const raw = response(); raw.answers.housing = answer('relevant', '월세가 부담돼요');
  let captured;
  const result = await analyze({ mode: 'gemini', text: '월세가 부담돼요', consent: true }, { project: 'test-project', billingConfirmed: true, generate: async options => { captured = options; return vertexResponse(raw); } });
  assert.equal(captured.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(JSON.parse(captured.payload.contents[0].parts[0].text).state, { userSituation: '월세가 부담돼요' });
  assert.deepEqual(captured.payload.generationConfig.responseSchema.properties.answers.required, topicKeys);
  assert.equal(captured.payload.generationConfig.candidateCount, 1);
  assert.equal(captured.payload.generationConfig.maxOutputTokens, 2048);
  assert.deepEqual(result.topics, ['housing']); assert.equal(result.mode, 'gemini');
});
test('할당량·불량 응답·차단·잘린 출력은 체험 결과로 위장하거나 재시도하지 않는다', async () => {
  let calls = 0;
  const truncated = vertexResponse(response()); truncated.candidates[0].finishReason = 'MAX_TOKENS';
  const blocked = { promptFeedback: { blockReason: 'SAFETY' } };
  for (const outcome of [new Error('secret-token'), {}, truncated, blocked]) {
    await assert.rejects(analyze({ mode: 'gemini', text: '월세 부담', consent: true }, { project: 'test-project', billingConfirmed: true, generate: async () => { calls++; if (outcome instanceof Error) throw outcome; return outcome; } }), e => e.status === 502 && !e.message.includes('secret-token'));
  }
  assert.equal(calls, 4);
});
const govRow = (id, overrides = {}) => ({ '서비스ID': id, '서비스명': '주거 지원', '소관기관명': '서울특별시 강남구', '소관기관유형': '시군구', '서비스분야': '주거·자립', '상세조회URL': `https://www.gov.kr/portal/rcvfvrSvc/dtlEx/${id}`, '지원대상': '대상 원문', '선정기준': null, '지원내용': '지원 원문', '신청방법': '방문신청', ...overrides });
const govPage = (page, totalCount, data) => ({ ok: true, json: async () => ({ page, totalCount, currentCount: data.length, data }) });
test('인증키 없이 전체 수집을 시작하지 않는다', async () => {
  await assert.rejects(syncCatalog({ key: '', fetcher: () => { throw new Error('no'); } }), /GOV24_API_KEY/);
});
test('전체 수집은 모든 페이지와 ID를 확인하고 키를 URL에 넣지 않는다', async () => {
  const calls = [];
  const result = await syncCatalog({ key: 'test%2Bkey', fetcher: async (url, init) => {
    calls.push({ url, init });
    return Number(url.searchParams.get('page')) === 1 ? govPage(1, 3, [govRow('a'), govRow('b')]) : govPage(2, 3, [govRow('c')]);
  } });
  assert.equal(calls.length, 2); assert.equal(result.items.length, 3); assert.equal(result.coverage.complete, true);
  assert.equal(calls[0].url.searchParams.has('serviceKey'), false);
  assert.equal(calls[0].init.headers.Authorization, 'Infuser test+key');
  assert.equal(result.coverage.agencyCounts['시군구'], 3);
});
test('수집 중복·건수 변경·빈 페이지·HTTP 실패는 부분 결과로 위장하지 않는다', async () => {
  for (const second of [govPage(2, 2, [govRow('a')]), govPage(2, 3, [govRow('b')]), govPage(2, 2, []), { ok: false, status: 429 }]) {
    await assert.rejects(syncCatalog({ key: 'test', fetcher: async url => Number(url.searchParams.get('page')) === 1 ? govPage(1, 2, [govRow('a')]) : second }));
  }
});
test('원문·누락 조건·기관 지역을 보존하고 외부 링크를 거부한다', () => {
  const item = normalizeBenefit(govRow('a'));
  assert.equal(normalizeBenefit(govRow('merged', { '소관기관명': '전남광주통합특별시 영암군' })).region, '전남광주');
  assert.equal(item.region, '서울'); assert.equal(item.criteria, ''); assert.equal(item.target, '대상 원문');
  assert.ok(item.topics.includes('housing'));
  assert.equal(normalizeBenefit(govRow('b', { '소관기관명': '한국주택금융공사' })).region, null);
  assert.throws(() => normalizeBenefit(govRow('a', { '상세조회URL': 'https://www.gov.kr.evil.example/a' })));
  assert.throws(() => normalizeBenefit(govRow('a', { '상세조회URL': 'javascript:alert(1)' })));
});
test('복수 분야는 중복되지 않고 타지역 지방정부 후보를 제외한다', () => {
  const items = [normalizeBenefit(govRow('a')), normalizeBenefit(govRow('b', { '소관기관명': '부산광역시' })), normalizeBenefit(govRow('c', { '소관기관명': '국토교통부', '소관기관유형': '중앙행정기관' }))];
  assert.equal(recommend(items, ['housing'], profile).length, 3);
  const result = recommend(items, ['housing', 'housing'], { ...profile, region: '서울' });
  assert.deepEqual(result.map(item => item.servId).sort(), ['a', 'c']);
  assert.ok(result.find(item => item.servId === 'a').notes.some(note => note.includes('시·군·구')));
});
test('실제 전체 수집본은 공식 건수·유일 ID·모든 항목의 출처가 일치한다', async () => {
  const full = JSON.parse(await readFile(new URL('../data/benefits.json', import.meta.url), 'utf8'));
  assert.equal(full.items.length, full.coverage.expected); assert.equal(full.coverage.complete, true);
  assert.equal(new Set(full.items.map(item => item.id)).size, full.items.length);
  for (const item of full.items) { assert.ok(item.title); assert.equal(new URL(item.url).hostname, 'www.gov.kr'); assert.ok(item.topics.every(topic => topicKeys.includes(topic))); }
});
test('HTTP 요청 검증과 비밀 미노출, 정상 추천 흐름', async () => {
  const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  const { server } = await startServer({ port: 0 });
  process.env.NODE_ENV = old || '';
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await (await fetch(base + '/api/status')).json(); assert.equal(typeof status.geminiConfigured, 'boolean');
    assert.equal(JSON.stringify(status).includes('API_KEY'), false);
    const request = (route, data, more = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...more }, body: JSON.stringify(data) });
    assert.equal((await request('/api/analyze', { text: '', mode: 'demo' })).status, 400);
    assert.equal((await request('/api/analyze', { text: '취업 준비', mode: 'demo' }, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await fetch(base + '/api/analyze', { method: 'POST', body: 'bad' })).status, 415);
    assert.equal((await request('/api/analyze', { text: 'x'.repeat(18000), mode: 'demo' })).status, 413);
    const result = await (await request('/api/recommend', { topics: ['housing'], profile })).json(); assert.equal(result.items.length, 30); assert.ok(result.total > 30);
    const index = await (await fetch(base + '/api/catalog')).json();
    assert.equal(index.items[0].criteria, undefined);
    const detail = await (await fetch(base + '/api/benefit?id=' + encodeURIComponent(result.items[0].id))).json(); assert.equal(detail.id, result.items[0].id); assert.equal(typeof detail.criteria, 'string');
    assert.equal((await fetch(base + '/api/benefit?id=unknown')).status, 404);
    assert.equal((await request('/api/recommend', { topics: [], profile })).status, 200);
    const second = await (await request('/api/recommend', { topics: ['housing'], profile, page: 2 })).json();
    assert.equal(second.page, 2); assert.ok(second.items.every(x => x.accepting !== false)); assert.ok(second.items.every(x => !result.items.some(y => y.id === x.id)));
    assert.equal((await request('/api/recommend', { topics: [], profile, page: 0 })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('공식 응답의 문자참조와 URL 구분자를 복원한다', () => {
  assert.equal(plainText('지원&#13;조건 &amp;#9312; &lt;b&gt;확인&lt;/b&gt;'), '지원 조건 ① 확인');
  assert.equal(plainText('https://www.bokjiro.go.kr/test?a=1&amp;b=2'), 'https://www.bokjiro.go.kr/test?a=1&b=2');
  assert.equal(plainText('&#99999999;'), '&#99999999;');
  assert.equal(plainText('<신청 제외> ○ 조건\\r\\n다음'), '<신청 제외> ○ 조건 다음');
});


test('개인조건은 검증하고 빈 조건으로 탈락시키지 않는다', () => {
  const items = [{ ...catalog.items[0], id: 'match', conditions: { JA0110: 19, JA0111: 35, JA0102: 'Y', JA0327: 'Y', JA0412: 'Y' } }, { ...catalog.items[0], id: 'outside', conditions: { JA0110: 65, JA0111: 120 } }, { ...catalog.items[0], id: 'unknown' }];
  const p = Profile.parse({ age: 25, sex: 'female', employment: 'seeking', special: ['JA0412'], financialAssets: 0 });
  const results = recommend(items, [], p);
  assert.equal(results.length, 3); assert.equal(results[0].id, 'match'); assert.equal(results.at(-1).id, 'outside');
  assert.ok(results[0].matched.some(x => x.includes('무주택')));
  assert.ok(results[0].checks.some(x => x.includes('금액 규칙 미검증')));
  assert.equal(Profile.safeParse({ monthlyIncome: -1 }).success, false);
  assert.equal(Profile.safeParse({ special: ['invented'] }).success, false);
});
