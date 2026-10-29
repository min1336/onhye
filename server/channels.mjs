import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { plainText } from './welfare.mjs';
import { categories } from '../shared/topics.mjs';

export async function getPage(url, init = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) }); }
    catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    if (!response.ok) throw new Error(`공식 자료 응답 오류 ${response.status}`);
    try { return await response.text(); } catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
}

export function channelItem(source, row) {
  const url = new URL(row.url);
  const hosts = { youth: ['youthcenter.go.kr'], myhome: ['myhome.go.kr', 'apply.lh.or.kr'], sbiz: ['sbiz24.kr'], bizinfo: ['bizinfo.go.kr'], arko: ['artnuri.or.kr', 'arko.or.kr', 'theater.arko.or.kr', 'inmun360.culture.go.kr'], iris: ['iris.go.kr'], mss: ['mss.go.kr'], kosaf: ['kosaf.go.kr'], seoul: ['youth.seoul.go.kr'], work: ['work24.go.kr'] }[source.id] || [];
  if (!hosts.some(host => url.hostname === host || url.hostname === `www.${host}` || url.hostname === `m.${host}`)) throw new Error(`공식 출처 도메인 불일치: ${url.hostname}`);
  if (url.protocol !== 'https:') throw new Error('공식 HTTPS 링크가 필요합니다.');
  const title = plainText(row.title);
  if (!title) throw new Error('공식 제목 누락');
  const topics = [...new Set([...(source.topics || []), ...Object.keys(categories).filter(key => categories[key].words.test(title))])];
  const deadline = plainText(row.deadline);
  const dates = deadline.match(/20\d{2}(?:[.\-/]\d{2}[.\-/]\d{2}|\d{4})/g) || [];
  const endDate = /~\s*$/.test(deadline) ? undefined : dates.at(-1)?.replaceAll(/[.\-/]/g, '');
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const accepting = row.accepting ?? (endDate && endDate < today ? false : undefined);
  return { id: `${source.id}-${row.rawId || createHash('sha256').update(url.href).digest('hex').slice(0, 20)}`, title,
    category: topics[0] || 'other', topics: topics.length ? topics : ['other'], agency: plainText(row.agency) || source.title,
    agencyType: '추가 공식 채널', region: null, audience: plainText(row.audience), summary: plainText(row.summary) || title,
    support: plainText(row.body) || '공개 목록 수집 항목입니다. 상세 지원내용과 첨부 조건은 공식 원문을 확인하세요.',
    target: plainText(row.target), criteria: '', application: '공식 원문에서 접수방법·신청 서식을 확인하세요.',
    deadline, accepting, endDate, checks: ['개인·기업·기관 대상 구분 확인', '지원대상·선정기준·첨부 조건 확인', '접수기간·정정·중복지원 여부 확인'],
    url: url.href, sourceTitle: source.title, sourceId: source.id, contentLevel: row.contentLevel || (row.body ? 'official-page' : 'public-list'),
    attachments: [...new Set((row.attachments || []).filter(link => { try { const file = new URL(link); return file.protocol === 'https:' && [...hosts, 'bizinfo.go.kr'].some(host => file.hostname === host || file.hostname === `www.${host}`); } catch { return false; } }))], contact: '', publisherType: row.publisherType || 'unknown' };
}
async function cachedPage(url, init = {}, refresh = false) {
  const directory = new URL('../.cache/channels/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const key = createHash('sha256').update(new Date().toISOString().slice(0, 10) + String(url) + (init.body || '')).digest('hex');
  const target = new URL(key + '.json', directory);
  const valid = text => {
    if (String(url).includes('iris.go.kr')) { try { return Boolean(JSON.parse(text).paginationInfo); } catch { return false; } }
    if (String(url).includes('work24.go.kr')) return text.includes('data-tracseid=');
    if (String(url).includes('thearts.arko.or.kr')) return load(text)('a.item[href]').length > 0;
    return text.includes('selectSIIA200Detail.do');
  };
  if (!refresh) {
    try { const cached = await readFile(target, 'utf8'); if (valid(cached)) return cached; await unlink(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const text = await getPage(url, init);
  if (!valid(text)) throw new Error('공식 목록 형식 확인 실패: 오류 페이지는 캐시하지 않음');
  const pending = new URL(key + '.pending', directory);
  await writeFile(pending, text); await rename(pending, target);
  return text;
}
async function readPages(pages, reader, progress) {
  const results = new Array(pages.length);
  let next = 0, done = 0, failed = false;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(4, pages.length) }, async () => {
    while (!failed && next < pages.length) {
      const index = next++;
      try { results[index] = await reader(pages[index]); }
      catch (error) { failed = true; throw error; }
      done++;
      if (done % 50 === 0 || done === pages.length) progress?.(done, pages.length);
    }
  }));
  for (const worker of workers) if (worker.status === 'rejected') throw worker.reason;
  return results;
}
function dedupe(items) { return [...new Map(items.map(item => [item.id, item])).values()]; }
export function parseArko(html, source) {
  const $ = load(html);
  return $('a.item[href]').map((i, el) => {
    const a = $(el), url = new URL(a.attr('href'));
    return channelItem(source, { rawId: url.searchParams.get('docid') || (url.searchParams.has('cid') ? `legacy-${url.searchParams.get('cid')}` : undefined), url: url.href, title: a.find('.title').text(), agency: a.find('.badge.bk').text(), deadline: a.find('.date').text(), summary: a.find('.info').text() });
  }).get();
}
export function parseMss(html, source) {
  const $ = load(html);
  return $('tr[onclick*="doBbsFView"]').map((i, el) => { const r = $(el), id = r.attr('onclick').match(/doBbsFView\('310','(\d+)'/)[1];
    const deadline = r.find('dl').filter((i, d) => $(d).find('dt').text().includes('신청기간')).find('dd').text();
    return channelItem(source, { rawId: id, url: `https://mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=${id}`, title: r.find('a.pc-detail').text(), deadline,
      attachments: [...new Set(r.find('[data-href]').map((i, a) => new URL($(a).attr('data-href'), 'https://mss.go.kr').href).get())] });
  }).get();
}
export function parseSeoul(html, source) {
  const $ = load(html);
  return $('a[onclick*="goView"]').map((i, el) => { const a = $(el), id = a.attr('onclick').match(/goView\('(\d+)'/)[1]; return channelItem(source, { rawId: id, url: `https://youth.seoul.go.kr/bbs/view.do?key=2303300002&pstSn=${id}`, title: a.find('.ti').text() || a.text() }); }).get();
}
export async function collectArko(source, progress) {
  const base = 'https://thearts.arko.or.kr/thearts/news/contest?pageSize=100';
  const read = html => {
    const $ = load(html);
    return { items: parseArko(html, source), total: Number($('body').text().match(/총\s*([\d,]+)건/)?.[1].replaceAll(',', '')), records: $('a.item[href]').filter((i, el) => !$(el).find('.fix').length).length, pages: Number($('[data-page]').last().attr('data-page')) };
  };
  const first = read(await getPage(base + '&page=1'));
  if (!first.total || !first.pages) throw new Error('아르코 전체 페이지 수 확인 실패');
  const rest = await readPages(Array.from({ length: first.pages - 1 }, (_, i) => i + 2), async page => {
    const url = base + '&page=' + page;
    const cached = read(await cachedPage(url));
    return cached.total === first.total ? cached : read(await cachedPage(url, {}, true));
  }, progress);
  const all = [first, ...rest], items = dedupe(all.flatMap(page => page.items)), recordCount = all.reduce((n, page) => n + page.records, 0);
  const complete = recordCount === first.total && all.every(page => page.total === first.total);
  return { items, expected: items.length, complete, sourceRecords: recordCount, scope: `공모 공개 목록 ${first.pages}페이지 전체 조회: 최초 ${first.total}행·최종 ${all.at(-1).total}행·수집 ${recordCount}행 후 원문 ID·URL 중복 통합(공공·민간 혼합). ${complete ? '목록 건수 일치' : '목록 변경 또는 공식 페이지별 총건수 표기 차이로 완전성 추가 확인 필요'}. 상세·첨부 미해석` };
}
export async function collectMss(source, progress) {
  const base = 'https://mss.go.kr/site/smba/ex/bbs/List.do?cbIdx=310';
  const first = await getPage(base), $ = load(first);
  const text = $('body').text().replace(/\s+/g, ' ');
  const expected = Number(text.match(/전체\s*:\s*([\d,]+)건/)?.[1].replaceAll(',', ''));
  const pages = Number(text.match(/현재 페이지\s*:\s*1\s*\/\s*(\d+)/)?.[1]);
  const year = $('input[name=searchPublicDate]').val();
  if (!expected || !pages) throw new Error('중기부 전체 페이지 수 확인 실패');
  const items = parseMss(first, source);
  for (let page = 2; page <= pages; page++) { items.push(...parseMss(await getPage(base + '&pageIndex=' + page), source)); if (page % 25 === 0) progress?.(page, pages); }
  const unique = dedupe(items);
  if (unique.length !== expected) throw new Error(`중기부 건수 불일치 ${unique.length}/${expected}`);
  return { items: unique, expected, scope: `사업공고 공개 게시판 ${year} 필터 전체, 첨부 링크 보존·내용 미해석` };
}
export function parseSeoulSupport(html, source) {
  const $ = load(html);
  return $('a.item-overlay[onclick*="goView"]').map((i, el) => {
    const a = $(el), id = a.attr('onclick').match(/goView\('([0-9]+)'/)[1], item = a.parent();
    const state = item.find('.state').text().trim();
    return channelItem(source, { rawId: `support-${id}`, url: `https://youth.seoul.go.kr/infoData/sprtInfo/view.do?key=2309130006&sprtInfoId=${id}`, title: item.find('.name').text(), summary: `${item.find('.cate').text().trim()} · ${state}`, accepting: state === '모집중' ? true : state === '마감' ? false : undefined });
  }).get();
}
export async function collectSeoul(source, progress) {
  const html = await getPage('https://youth.seoul.go.kr/bbs/list.do?key=2303300002&sc_bbsCtgrySn=2304110001&recordCountPerPage=100');
  const $ = load(html); $('script,style').remove();
  const expected = Number($('body').text().replace(/\s+/g, ' ').match(/전체\s*(\d+)\s*건/)?.[1]);
  const items = dedupe(parseSeoul(html, source));
  if (!expected || items.length !== expected) throw new Error('서울 청년 공지 전체 건수 확인 실패');
  const base = 'https://youth.seoul.go.kr/infoData/sprtInfo/list.do?key=2309130006&recordCountPerPage=100';
  const first = await getPage(base), doc = load(first);
  const total = Number(doc('body').text().replace(/\s+/g, ' ').match(/전체\s*([\d,]+)건/)?.[1].replaceAll(',', ''));
  const support = parseSeoulSupport(first, source);
  if (!total || !support.length) throw new Error('서울 청년지원정보 전체 건수 확인 실패');
  const pages = Math.ceil(total / support.length);
  const rest = await readPages(Array.from({ length: pages - 1 }, (_, i) => i + 2), async page => parseSeoulSupport(await getPage(base + '&pageIndex=' + page), source), progress);
  for (const rows of rest) support.push(...rows);
  if (support.length !== total || new Set(support.map(item => item.id)).size !== total) throw new Error('서울 청년지원정보 전체 건수·ID 불일치');
  items.push(...support);
  return { items, expected: items.length, sourceRecords: expected + total, scope: `서울 청년정책 공지 ${expected}개(행사·결과 포함) 및 지역별 청년지원정보 ${total}개 전체 공개 목록. 상세·첨부 조건 미해석` };
}
export function parseKosafNotices(html, source) {
  const $ = load(html);
  return $('td.subject a[href*="seqNo="]').map((i, el) => {
    const a = $(el), url = new URL(a.attr('href'), 'https://www.kosaf.go.kr/ko/notice.do');
    return channelItem(source, { rawId: `notice-${url.searchParams.get('seqNo')}`, url: url.href, title: a.text(), agency: '한국장학재단', summary: `게시일 ${a.closest('tr').find('td.day').text().trim()} · 모집·행정 공지: 세부 내용은 공식 원문 확인` });
  }).get();
}
export async function collectKosaf(source, progress) {
  const base = 'https://www.kosaf.go.kr/ko/scholar.do?pg=scholarship_submain01';
  const $ = load(await getPage(base));
  const links = new Map();
  $('a[href*="scholar.do?pg="],a[href*="tuition.do?pg="]').each((i, a) => { const url = new URL($(a).attr('href'), base), pg = url.searchParams.get('pg'); if (/^(?:scholarship|tuition)\d/.test(pg) && !links.has(pg)) links.set(pg, { url: url.href, title: $(a).text().trim() }); });
  if (!links.size) throw new Error('장학재단 제도 링크 확인 실패');
  const items = [];
  for (const [pg, row] of links) {
    const doc = load(await getPage(row.url)); doc('script,style,nav,iframe,.msub-menu').remove();
    const body = doc('.page-cont-wrap,.page-subcont-wrap').text().replace(/\s+/g, ' ').trim();
    if (!body) throw new Error('장학재단 본문 누락');
    items.push(channelItem(source, { ...row, rawId: pg, body, summary: body.slice(0, 400), agency: '한국장학재단', audience: '학생·학자금 대출 이용자: 안내별 대상 확인', target: '공식 본문의 지원자격 확인' })); progress?.(items.length, links.size);
  }
  const noticeBase = 'https://www.kosaf.go.kr/ko/notice.do?pg=PTKONotice_List';
  const first = await getPage(noticeBase), doc = load(first);
  const total = Number(doc('body').text().replace(/\s+/g, ' ').match(/전체\s*([\d,]+)개의 게시물/)?.[1].replaceAll(',', ''));
  const notices = parseKosafNotices(first, source);
  if (!total || !notices.length) throw new Error('장학재단 전체 공지 건수 확인 실패');
  const pages = Math.ceil(total / notices.length);
  const rest = await readPages(Array.from({ length: pages - 1 }, (_, i) => i + 2), async page => parseKosafNotices(await getPage(noticeBase + '&page=' + page), source), progress);
  for (const rows of rest) notices.push(...rows);
  if (notices.length !== total || new Set(notices.map(item => item.id)).size !== total) throw new Error('장학재단 공지 전체 건수·ID 불일치');
  items.push(...notices);
  return { items, expected: items.length, sourceRecords: total + links.size, scope: `장학금·학자금 대출 제도·절차 안내 ${links.size}개와 전체 공지 ${total}개(모집·행정 공지 혼재) 수집. 로그인 정보·공지 상세·첨부 해석 제외` };
}

export async function collectYouth(source, progress) {
  const items = []; let expected;
  for (let pageNum = 1; expected === undefined || items.length < expected; pageNum++) {
    const text = await getPage('https://www.youthcenter.go.kr/pubot/search/portalPolicySearch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageNum, listCount: 100, searchFields: 'all', query: '', sortFields: 'DATE/DESC' }) });
    const body = JSON.parse(text), rows = body.searchResult?.youthpolicy;
    if (!Number.isSafeInteger(body.totalCount) || !rows?.length || (expected !== undefined && expected !== body.totalCount)) throw new Error('온통청년 전체 건수·페이지 불일치');
    expected = body.totalCount;
    for (const row of rows) items.push(channelItem(source, { rawId: row.DOCID, title: row.PLCY_NM, url: `https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch/ythPlcyDetail/${row.DOCID}`, agency: row.SPRVSN_INST_CD_NM,
      body: `${row.PLCY_EXPLN_CN || ''} ${row.PLCY_SPRT_CN || ''}`, summary: row.PLCY_EXPLN_CN,
      target: [row.EMPM_STTS_NM, row.SPCL_FLD_NM, row.ADD_APLY_QLFC_CND_CN, row.PLCY_APLY_MTHD_CN, row.SRNG_MTHD_CN].filter(Boolean).join(' · '),
      deadline: [row.APLY_PRD_BGNG_YMD, row.APLY_PRD_END_YMD].filter(Boolean).join(' ~ ') }));
    progress?.(items.length, expected);
    if (items.length > expected) throw new Error('온통청년 전체 건수 초과');
  }
  if (dedupe(items).length !== expected) throw new Error('온통청년 페이지 간 중복');
  return { items, expected, scope: '온통청년 공개 통합검색 전체 정책, 지원내용 포함·첨부 미해석' };
}
export async function collectMyhome(source, progress) {
  const key = process.env.MYHOME_API_KEY || process.env.WELFARE_API_KEY;
  if (!key) throw new Error('마이홈 인증키 필요');
  const items = []; let total = 0;
  for (const op of ['rsdtRcritNtcList', 'ltRsdtRcritNtcList']) {
    let expected, count = 0;
    for (let page = 1; expected === undefined || count < expected; page++) {
      const url = new URL(`https://apis.data.go.kr/1613000/HWSPR02/${op}`);
      url.search = new URLSearchParams({ serviceKey: decodeURIComponent(key), pageNo: String(page), numOfRows: '100' });
      const body = JSON.parse(await getPage(url)).response;
      if (body?.header?.resultCode !== '00' || !body.body || !/^\d+$/.test(String(body.body.totalCount))) throw new Error('마이홈 인증·응답 확인 실패');
      const n = Number(body.body.totalCount);
      if (expected !== undefined && n !== expected) throw new Error('마이홈 수집 중 건수 변경');
      expected = n;
      const rows = Array.isArray(body.body.item) ? body.body.item : body.body.item ? [body.body.item] : [];
      if (!rows.length && count < expected) throw new Error('마이홈 페이지 누락');
      for (const row of rows) items.push(channelItem(source, { rawId: `${op}-${row.pblancId}-${row.houseSn || 0}-${createHash('sha256').update(JSON.stringify(Object.keys(row).sort().map(key => [key, row[key]]))).digest('hex').slice(0, 12)}`, title: `${row.pblancNm} · ${[row.hsmpNm, row.brtcNm, row.signguNm].filter(Boolean).join(' · ')}`, agency: row.suplyInsttNm, url: row.pcUrl || row.url,
        summary: [row.brtcNm, row.signguNm, row.suplyTyNm, row.houseTyNm].filter(Boolean).join(' · '),
        body: `${row.pblancNm} / ${row.hsmpNm || ''} / 공급 ${row.sumSuplyCo ?? '미확인'}호 / 임대보증금 ${row.rentGtn ?? '미확인'}원 / 월임대료 ${row.mtRntchrg ?? '미확인'}원 / ${row.refrnc || ''}`,
        target: '단지별 입주자격·세부 공급 조건은 공식 모집공고 확인', deadline: [row.beginDe, row.endDe].filter(Boolean).join(' ~ ') }));
      count += rows.length; progress?.(count, expected);
      if (count > expected) throw new Error('마이홈 전체 건수 초과');
      if (!expected) break;
    }
    total += expected;
  }
  const unique = dedupe(items);
  return { items: unique, expected: unique.length, sourceRecords: total, scope: `API 공공임대·공공분양 전체 ${total}행 조회 후 완전히 동일한 응답행 통합(지역·공급수 차이 보존), 첨부 미해석` };
}
export function parseIris(rows, source, phase) {
  return rows.filter(row => row.rcveSttSeNmLst?.trim() !== '미게시').map(row => channelItem(source, { rawId: row.ancmId, title: row.ancmTl, agency: `${row.blngGovdSeNm || ''} · ${row.sorgnNm || ''}`, url: `https://www.iris.go.kr/contents/retrieveBsnsAncmView.do?ancmId=${row.ancmId}&ancmPrg=${phase}`, summary: `${row.ancmNo || ''} · ${row.pbofrTpSeNmLst || ''} · ${row.rcveSttSeNmLst || '공고상태 확인 필요'}`, deadline: `${row.rcveStrDe || ''} ~ ${row.rcveEndDe || ''}`, accepting: phase === 'ancmEnd' ? false : phase === 'ancmIng' ? true : undefined, audience: '연구자·기관·기업: 공고별 대상 확인' }));
}
export async function collectIris(source, progress) {
  const items = []; let expectedTotal = 0, unpublished = 0;
  for (const phase of ['ancmEnd', 'ancmPre', 'ancmIng']) {
    const fetchPage = async page => JSON.parse(await cachedPage('https://www.iris.go.kr/contents/retrieveBsnsAncmBtinSituList.do', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ancmPrg: phase, pageIndex: String(page) }) }));
    const first = await fetchPage(1), expected = first.paginationInfo?.totalRecordCount, pages = first.paginationInfo?.totalPageCount;
    if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(pages)) throw new Error('IRIS 공식 페이지 건수 누락');
    const rows = [...(first.listBsnsAncmBtinSitu || [])];
    const rest = await readPages(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2), async page => {
      const body = await fetchPage(page);
      if (body.paginationInfo?.totalRecordCount !== expected || body.paginationInfo?.currentPageNo !== page || !body.listBsnsAncmBtinSitu?.length) throw new Error('IRIS 전체 건수·페이지 불일치');
      return body.listBsnsAncmBtinSitu;
    }, progress);
    for (const list of rest) rows.push(...list);
    if (rows.length !== expected || new Set(rows.map(row => row.ancmId)).size !== expected) throw new Error('IRIS 페이지 간 ID·전체 건수 불일치');
    unpublished += rows.filter(row => row.rcveSttSeNmLst?.trim() === '미게시').length;
    items.push(...parseIris(rows, source, phase));
    expectedTotal += expected; progress?.(expected, expected);
  }
  const unique = dedupe(items);
  return { items: unique, expected: unique.length, sourceRecords: expectedTotal, scope: `종료·예정·진행 공개 목록 ${expectedTotal}행 전체 조회 후 공식 미게시 ${unpublished}행 제외·ID 통합. 상세·첨부 미해석` };
}

export async function collectSbiz(source, progress) {
  const items = []; let total = 0;
  for (const path of ['/api/pbanc/sbiz24PbancList', '/api/exltdPbanc']) {
    let expected;
    for (let start = 0; expected === undefined || start < expected; start += 100) {
      const body = JSON.parse(await getPage('https://www.sbiz24.kr' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'Origin-Method': 'GET' }, body: JSON.stringify({ search: {}, paging: true, startRow: start, endRow: start + 100, sortModel: [] }) }));
      const data = body.data?.default;
      if (!body.result || !data || !Number.isSafeInteger(data.page?.totalElements) || !Array.isArray(data.list) || (expected !== undefined && expected !== data.page.totalElements)) throw new Error('소상공인24 전체 건수·페이지 불일치');
      expected = data.page.totalElements;
      if (!data.list.length && start < expected) throw new Error('소상공인24 페이지 누락');
      for (const row of data.list) {
        const external = path === '/api/exltdPbanc';
        const html = load(row.bizOutlCn || ''); html('script,style').remove();
        items.push(channelItem(source, { rawId: `${external ? 'external' : 'pbanc'}-${external ? row.pbancId : row.pbancSn}`, title: row.pbancNm || row.linkPbancNm,
          url: `https://www.sbiz24.kr/#/${external ? 'extldPbanc/' + row.pbancId : 'pbanc/' + row.pbancSn}`,
          agency: row.jrsdInstNm || '소상공인24 제공기관', summary: html.text().trim().slice(0, 400), body: html.text().trim(), target: row.sprtTrgtNm,
          deadline: row.rcptPd ? `${row.rcptPd.from || ''} ~ ${row.rcptPd.to || ''}` : row.aplyPdEndKornNm,
          attachments: [row.linkAtchFilePathNm, row.txtFilePathNm].filter(Boolean), accepting: row.aplyPsbltySe === 'Y' ? true : undefined }));
      }
      progress?.(Math.min(start + 100, expected), expected);
    }
    total += expected;
  }
  if (dedupe(items).length !== total) throw new Error('소상공인24 고유 ID 중복');
  return { items, expected: total, scope: '소진공·지방정부 공개 공고 통합목록 및 유관기관 공고 전체, 첨부 링크 보존·미해석' };
}
export function parseBizinfo(html, source, closed) {
  const $ = load(html);
  return $('a[href*="selectSIIA200Detail.do"]').map((i, el) => { const a = $(el), row = a.closest('tr'), id = new URL(a.attr('href'), 'https://bizinfo.go.kr').searchParams.get('pblancId'); return channelItem(source, {
    rawId: id, title: a.text().trim() || a.attr('title') || `[원문 제목 미제공] ${id}`, url: `https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=${id}`, agency: row.find('td').eq(4).text(),
    summary: `${row.find('td').eq(1).text()} · ${row.find('td').eq(5).text()}`, deadline: row.find('td').eq(3).text(), accepting: closed ? false : undefined,
  }); }).get();
}
export async function collectBizinfo(source, progress) {
  const items = []; let rawTotal = 0;
  for (const closed of [false, true]) {
    const base = `https://bizinfo.go.kr/sii/siia/selectSIIA200View.do?schEndAt=${closed ? 'Y' : 'N'}`;
    const first = await getPage(base + '&cpage=1'), $ = load(first), firstRows = parseBizinfo(first, source, closed);
    const last = $('a[title="마지막페이지"]').attr('href');
    const pages = last ? Number(new URL(last, base).searchParams.get('cpage')) : 1;
    const expected = Number($('a[href*="selectSIIA200Detail.do"]').first().closest('tr').find('td').first().text().trim());
    if (!pages || !expected || !firstRows.length) throw new Error('기업마당 전체 목록·페이지 확인 실패');
    const rows = [...firstRows];
    for (let page = 2; page <= pages; page += 4) {
      const results = await Promise.allSettled([page, page + 1, page + 2, page + 3].filter(n => n <= pages).map(n => cachedPage(base + '&cpage=' + n)));
      for (const result of results) { if (result.status !== 'fulfilled') throw new Error('기업마당 페이지 연결 실패'); const list = parseBizinfo(result.value, source, closed); if (!list.length) throw new Error('기업마당 페이지 누락'); rows.push(...list); }
      if (page % 100 === 0 || page % 100 === 2) progress?.(page, pages);
    }
    if (rows.length !== expected) throw new Error(`기업마당 전체 건수 불일치 ${rows.length}/${expected}`);
    rawTotal += rows.length; items.push(...rows);
  }
  const unique = dedupe(items);
  return { items: unique, expected: unique.length, sourceRecords: rawTotal, scope: `진행·지난 지원사업 공고 ${rawTotal}행 전체 조회 후 원문 ID 통합, 목록 메타데이터·상세·첨부 미해석` };
}

export function parseWork(html, source) {
  const $ = load(html);
  return $('div.list[data-tracseid]').map((i, el) => {
    const row = $(el), link = row.find('a[onclick*="fn_viewTracseInfo("]').first();
    const args = [...(link.attr('onclick') || '').matchAll(/'([^']*)'/g)].map(match => match[1]);
    if (args.length < 4 || !link.text().trim()) throw new Error('고용24 훈련과정 ID·제목 확인 실패');
    const [tracseId, tracseTme, crseTracseSe, trainstCstmrId] = args;
    let operation = 'selectTracseDetl';
    if (crseTracseSe === 'C0041') operation += '2';
    else if (crseTracseSe === 'C0080') operation += '3';
    else if (['C0042', 'C0066', 'C0098'].includes(crseTracseSe)) operation += '4';
    else if (crseTracseSe === 'C0110') operation += '5';
    else if (['TR001', 'C0069', 'C0070', 'C0071', 'C0072', 'C0073', 'C0074', 'C0075'].includes(crseTracseSe)) operation = 'tracseDetl2';
    const url = new URL(`https://www.work24.go.kr/hr/a/a/3100/${operation}.do`);
    url.search = new URLSearchParams({ tracseId, tracseTme, crseTracseSe, trainstCstmrId });
    row.find('.box_tooltip,.box_help-data,button,input,script,style').remove();
    const text = row.text().replace(/\s+/g, ' ').trim();
    return channelItem(source, { rawId: `${tracseId}-${tracseTme}`, title: link.text(), agency: row.find('a[onclick*="fn_viewTrainstInfo"]').first().text(), url: url.href,
      summary: text.slice(0, 400), body: text, target: '훈련과정별 참여조건·내일배움카드·본인부담액·실제 모집상태 확인', contentLevel: 'public-list' });
  }).get();
}
export async function collectWork(source, progress) {
  const base = 'https://www.work24.go.kr/hr/a/a/1100/trnnCrsInf.do?pageRow=100';
  const first = await getPage(base + '&pageIndex=1'), $ = load(first);
  $('script,style').remove();
  const expected = Number($('body').text().replace(/\s+/g, ' ').match(/총\s*([\d,]+)건/)?.[1].replaceAll(',', ''));
  const size = Number($('#pageRow').val()), startDate = $('#startDate').val(), endDate = $('#endDate').val();
  if (!expected || size !== 100) throw new Error('고용24 공식 건수·페이지 크기 확인 실패');
  const pages = Math.ceil(expected / size), items = parseWork(first, source);
  let lastReported = expected;
  const rest = await readPages(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2), async page => {
    const html = await cachedPage(base + '&pageIndex=' + page);
    const doc = load(html); doc('script,style').remove();
    const total = Number(doc('body').text().replace(/\s+/g, ' ').match(/총\s*([\d,]+)건/)?.[1].replaceAll(',', ''));
    const list = parseWork(html, source);
    if (!list.length || !total) throw new Error('고용24 페이지 누락');
    return { list, total };
  }, progress);
  for (const result of rest) { items.push(...result.list); lastReported = result.total; }
  // Live offset pagination can change during collection; retain evidence instead of claiming a complete snapshot.
  const unique = dedupe(items), complete = unique.length === expected && expected === lastReported;
  return { items: unique, expected: unique.length, complete, sourceRecords: items.length, scope: `훈련 통합검색 ${startDate}~${endDate} 개강일 범위 ${pages}페이지 전체 조회. 최초 ${expected}건·최종 표기 ${lastReported}건·중복통합 ${unique.length}건. ${complete ? '건수 일치' : '수집 중 변경 또는 중복 있어 완전성 추가 확인 필요'}. 상세·모집상태는 원문 확인` };
}

export async function collectMssApi(source, progress) {
  const key = process.env.MSS_API_KEY || process.env.WELFARE_API_KEY;
  if (!key) throw new Error('중기부 API 인증키 필요');
  const items = new Map(); let expected;
  for (let page = 1; expected === undefined || items.size < expected; page++) {
    const url = new URL('https://apis.data.go.kr/1421000/mssBizService_v2/getbizList_v2');
    url.search = new URLSearchParams({ serviceKey: decodeURIComponent(key), pageNo: String(page), numOfRows: '1000' });
    const $ = load(await getPage(url), { xml: true });
    const total = Number($('body>totalCount').text());
    if ($('resultCode').text() !== '00' || !total || (expected !== undefined && expected !== total)) throw new Error('중기부 API 전체 건수·인증 확인 실패');
    expected = total;
    if (Number($('body>pageNo').text()) !== page || page > 100) throw new Error('중기부 페이지 응답·요청 한도 확인 필요');
    const before = items.size;
    const rows = $('items>item'); if (!rows.length) throw new Error('중기부 API 빈 페이지');
    rows.each((i, el) => {
      const row = $(el), body = load(row.find('dataContents').text()); body('script,style').remove();
      const rawId = row.find('itemId').text();
      const item = channelItem(source, { rawId, title: row.find('title').text(), url: row.find('viewUrl').text(), agency: `중소벤처기업부 ${row.find('writerPosition').text()}`, summary: body.text().replace(/\s+/g, ' ').trim().slice(0, 400), body: body.text(), deadline: `${row.find('applicationStartDate').text()} ~ ${row.find('applicationEndDate').text()}`, attachments: row.find('fileUrl').map((i, e) => $(e).text()).get().filter(url => url.startsWith('https://')) });
      if (items.has(item.id)) item.attachments = [...new Set([...items.get(item.id).attachments, ...item.attachments])];
      items.set(item.id, item);
    });
    if (items.size > expected || items.size === before) throw new Error('중기부 API 건수 초과');
    progress?.(items.size, expected);
  }
  if (items.size !== expected) throw new Error('중기부 API 전체 ID 건수 불일치');
  return { items: [...items.values()], expected, scope: '중기부 API 제공 사업공고 전체, 공식 본문·첨부 링크 포함. API 제공 범위 외 과거 게시물과 첨부 내용 해석 제외' };
}
