import test from 'node:test';
import assert from 'node:assert/strict';
import { channelItem, parseArko, parseMss, parseSeoul, parseBizinfo, parseWork, collectYouth, collectMyhome, collectMssApi, parseKosafNotices, parseSeoulSupport, parseIris } from '../server/channels.mjs';
const source = id => ({ id, title: id, topics: ['business'] });

test('추가 채널은 공식 링크·제목을 검증하고 알 수 없는 접수상태를 만들지 않는다', () => {
  const row = { title: '공고', url: 'https://www.sbiz24.kr/#/pbanc/1', attachments: ['javascript:alert(1)', 'https://evil.example/x', 'https://www.bizinfo.go.kr/a'] };
  const item = channelItem(source('sbiz'), row);
  assert.equal(item.accepting, undefined); assert.equal(item.contentLevel, 'public-list'); assert.equal(item.attachments.length, 1);
  assert.throws(() => channelItem(source('sbiz'), { ...row, url: 'https://evil.example' }));
  assert.throws(() => channelItem(source('sbiz'), { ...row, title: '' }));
  assert.equal(channelItem(source('sbiz'), { ...row, deadline: '20200101 ~ 20200131' }).accepting, false);
  assert.equal(channelItem(source('sbiz'), { ...row, deadline: '20200101 ~ ' }).accepting, undefined);
});
test('공개 목록에서 원문 ID·제목·접수기간·첨부를 보존한다', () => {
  const arko = parseArko('<a class="item" href="https://artnuri.or.kr/crawler/info/view.do?docid=a"><h2 class="title">예술 공모</h2><p class="date">2026.10.01 - 2026.12.01</p></a>', source('arko'));
  assert.equal(arko[0].id, 'arko-a'); assert.equal(arko[0].publisherType, 'unknown');
  const mss = parseMss(`<table><tr onclick="doBbsFView('310','123')"><td><a class="pc-detail">지원사업</a><dl><dt>신청기간</dt><dd>2026-01-01 ~ 2026-01-02</dd></dl><span data-href="/download/a.hwpx"></span></td></tr></table>`, source('mss'));
  assert.equal(mss[0].attachments[0], 'https://mss.go.kr/download/a.hwpx'); assert.equal(mss[0].accepting, false);
  const seoul = parseSeoul(`<a onclick="goView('123')"><span class="ti">청년 공지</span></a>`, source('seoul'));
  assert.equal(seoul[0].id, 'seoul-123');
  const biz = parseBizinfo('<table><tr><td>1</td><td>금융</td><td><a href="/sii/siia/selectSIIA200Detail.do?pblancId=a" title="제목 누락 공고"></a></td><td>미정</td></tr></table>', source('bizinfo'), true);
  assert.equal(biz[0].title, '제목 누락 공고'); assert.equal(biz[0].accepting, false);
});
test('훈련과정의 ID·회차·공식 상세 경로를 보존하고 툴팁 안내문을 본문에서 뺀다', () => {
  const rows = parseWork(`<div class="list" data-tracseid="id"><a onclick="fn_viewTrainstInfo('id')">학원</a><a onclick="fn_viewTracseInfo('id','2','C0041','org')">과정</a><div class="box_tooltip">일반 설명</div><p>기간 2026-12-01</p></div>`, source('work'));
  assert.equal(rows[0].id, 'work-id-2'); assert.ok(rows[0].url.includes('selectTracseDetl2.do')); assert.equal(rows[0].support.includes('일반 설명'), false);
});
test('온통청년은 모든 페이지를 수집하고 중복 페이지·전체 건수 변경을 거부한다', async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (url, init) => { const page = JSON.parse(init.body).pageNum; calls++; return { ok: true, text: async () => JSON.stringify({ totalCount: 2, searchResult: { youthpolicy: [{ DOCID: String(page), PLCY_NM: `정책 ${page}` }] } }) }; };
    const data = await collectYouth(source('youth')); assert.equal(data.items.length, 2); assert.equal(calls, 2);
    globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ totalCount: 2, searchResult: { youthpolicy: [{ DOCID: 'same', PLCY_NM: '중복' }] } }) });
    await assert.rejects(collectYouth(source('youth')), /중복/);
  } finally { globalThis.fetch = original; }
});
test('마이홈은 두 종류의 전체 행을 조회하고 원문 ID 중복을 통합해 수치를 구분한다', async () => {
  const original = globalThis.fetch, key = process.env.MYHOME_API_KEY;
  process.env.MYHOME_API_KEY = 'test';
  try {
    globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: '2', item: [1, 2].map(() => ({ pblancId: 'a', houseSn: 1, pblancNm: '주택', pcUrl: 'https://www.myhome.go.kr/x' })) } } }) });
    const data = await collectMyhome(source('myhome'));
    assert.equal(data.sourceRecords, 4); assert.equal(data.items.length, 2); assert.equal(data.expected, 2);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.MYHOME_API_KEY; else process.env.MYHOME_API_KEY = key; }
});

test('마이홈의 같은 공고·주택 ID라도 지역이 다른 공급행은 보존한다', async () => {
  const original = globalThis.fetch, key = process.env.MYHOME_API_KEY;
  process.env.MYHOME_API_KEY = 'test';
  try {
    globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: '2', item: ['서울', '부산'].map(brtcNm => ({ pblancId: 'a', houseSn: 1, brtcNm, pblancNm: '주택', pcUrl: 'https://www.myhome.go.kr/x' })) } } }) });
    const data = await collectMyhome(source('myhome'));
    assert.equal(data.items.length, 4); assert.equal(new Set(data.items.map(x => x.id)).size, 4);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.MYHOME_API_KEY; else process.env.MYHOME_API_KEY = key; }
});
test('중기부의 중복 ID는 첨부를 합치고 고유 공고 전체 건수까지 계속 수집한다', async () => {
  const original = globalThis.fetch, key = process.env.MSS_API_KEY;
  process.env.MSS_API_KEY = 'test';
  try {
    globalThis.fetch = async url => {
      const page = Number(new URL(url).searchParams.get('pageNo'));
      const ids = page === 1 ? ['a', 'a'] : ['b'];
      return { ok: true, text: async () => `<response><header><resultCode>00</resultCode></header><body><totalCount>2</totalCount><pageNo>${page}</pageNo><items>${ids.map((id, i) => `<item><itemId>${id}</itemId><title>공고</title><viewUrl>https://mss.go.kr/view/${id}</viewUrl><dataContents>공식 본문</dataContents><fileUrl>https://mss.go.kr/file/${page}-${i}</fileUrl></item>`).join('')}</items></body></response>` };
    };
    const data = await collectMssApi(source('mss'));
    assert.equal(data.items.length, 2); assert.equal(data.items[0].attachments.length, 2);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.MSS_API_KEY; else process.env.MSS_API_KEY = key; }
});

test('장학재단 공지의 게시일을 신청 마감일로 오인하지 않는다', () => {
  const rows = parseKosafNotices('<table><tr><td class="subject"><a href="?mode=view&amp;seqNo=123">학기 모집 안내</a></td><td class="day">2020.01.01</td></tr></table>', source('kosaf'));
  assert.equal(rows[0].id, 'kosaf-notice-123'); assert.equal(rows[0].accepting, undefined); assert.ok(rows[0].summary.includes('2020.01.01')); assert.ok(rows[0].url.startsWith('https://www.kosaf.go.kr/ko/notice.do?'));
});

test('서울 청년지원정보는 공식 모집상태와 상세 ID를 보존한다', () => {
  const rows = parseSeoulSupport(`<div class="item"><a class="item-overlay" onclick="goView('123')">이미지 대체문구</a><div class="name">교육생 모집</div><span class="cate">교육</span><span class="state">모집중</span></div>`, source('seoul'));
  assert.equal(rows[0].id, 'seoul-support-123'); assert.equal(rows[0].title, '교육생 모집'); assert.equal(rows[0].accepting, true); assert.ok(rows[0].url.includes('sprtInfoId=123'));
});

test('IRIS는 공식 미게시 자료를 빼고 예고 공고는 자격 미확인 상태로 보존한다', () => {
  const rows = parseIris([{ ancmId: 'draft', ancmTl: 'TEST', rcveSttSeNmLst: '미게시' }, { ancmId: 'real', ancmTl: '신규과제 공모', rcveSttSeNmLst: '공고예고', rcveStrDe: '2026.12.01', rcveEndDe: '2026.12.31' }], source('iris'), 'ancmPre');
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'iris-real'); assert.equal(rows[0].accepting, undefined);
});

test('아르코는 이전 게시판·극장·암호화 상세 링크를 누락하지 않는다', () => {
  const html = ['https://arko.or.kr/board/view/4013?cid=123', 'https://theater.arko.or.kr/a', 'https://artnuri.or.kr/crawler/info/view.do?encData=abc'].map(url => `<a class="item" href="${url}"><h2 class="title">공모</h2></a>`).join('');
  const rows = parseArko(html, source('arko')); assert.equal(rows.length, 3); assert.equal(rows[0].id, 'arko-legacy-123'); assert.equal(new Set(rows.map(x => x.id)).size, 3);
});
