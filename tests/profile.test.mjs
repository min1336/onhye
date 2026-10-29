import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractProfile } from '../shared/profile.mjs';
import { normalizeAnnouncement, syncAnnouncements } from '../server/announcements.mjs';
import { attachConditions } from '../server/welfare.mjs';

test('상황에서 명시한 나이·직업·금액을 추출하고 미확인 금액과 0원을 구별', () => {
  const p = extractProfile('만 25세 남성 서울에서 취업 준비 중입니다. 무주택 1인 가구이고 예금 500만원, 개인 월소득 0원입니다.');
  assert.equal(p.age, 25); assert.equal(p.sex, 'male'); assert.equal(p.region, '서울'); assert.equal(p.employment, 'seeking');
  assert.equal(p.financialAssets, 5000000); assert.equal(p.monthlyIncome, 0); assert.equal(p.householdIncome, null);
  assert.deepEqual(p.special, ['JA0404', 'JA0412']);
  assert.equal(extractProfile('보유금액 500만원').financialAssets, null);
  assert.equal(extractProfile('남성 여성이 함께 신청').sex, 'unknown');
  assert.deepEqual(extractProfile('장애인이 아니에요').special, []);
});

test('지원조건을 서비스 ID로 연결하고 누락 조건을 만들지 않는다', async () => {
  const catalog = { coverage: {}, items: [{ servId: 'a' }, { servId: 'missing' }] };
  const fetcher = async url => {
    assert.equal(url.pathname, '/api/gov24/v3/supportConditions');
    return { ok: true, json: async () => ({ page: 1, totalCount: 1, currentCount: 1, data: [{ 서비스ID: 'a', JA0110: 0, JA0101: 'Y', JA0102: null }] }) };
  };
  await attachConditions(catalog, { key: 'test', fetcher });
  assert.deepEqual(catalog.items[0].conditions, { JA0110: 0, JA0101: 'Y' });
  assert.equal(catalog.items[1].conditions, undefined); assert.equal(catalog.coverage.conditionImported, 1);
});

test('창업 공고 전체 수집은 모든 페이지·고유 ID를 검증하며 실패 시 결과를 반환하지 않는다', async () => {
  const row = n => ({ pbanc_sn: n, detl_pg_url: `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?pbancSn=${n}`, biz_pbanc_nm: `공고 ${n}`, supt_regin: '전국', rcrt_prgs_yn: 'N' });
  let calls = 0;
  const fetcher = async url => { const page = Number(url.searchParams.get('page')); calls++; return { ok: true, json: async () => ({ page, currentCount: 1, totalCount: 2, data: [row(page)] }) }; };
  const data = await syncAnnouncements({ key: 'test', fetcher });
  assert.equal(calls, 2); assert.equal(data.items.length, 2); assert.equal(data.items[0].region, null); assert.equal(data.items[0].accepting, false);
  assert.throws(() => normalizeAnnouncement({ ...row(1), detl_pg_url: 'https://evil.example/' }));
  await assert.rejects(syncAnnouncements({ key: 'test', fetcher: async () => ({ ok: true, json: async () => ({ page: 1, totalCount: 2, currentCount: 1, data: [row(1)] }) }) }));
});

test('창업 공고 수집본의 건수·ID·공식 링크가 일치한다', async () => {
  const data = JSON.parse(await readFile(new URL('../data/announcements.json', import.meta.url), 'utf8'));
  assert.equal(data.items.length, data.coverage.expected); assert.equal(new Set(data.items.map(x => x.id)).size, data.items.length);
  for (const item of data.items) assert.equal(new URL(item.url).hostname, 'www.k-startup.go.kr');
});
