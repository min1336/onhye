import { plainText } from './welfare.mjs';

export function normalizeAnnouncement(row) {
  const url = new URL(row.detl_pg_url);
  if (url.protocol !== 'https:' || url.hostname !== 'www.k-startup.go.kr' || !Number.isSafeInteger(row.pbanc_sn)) throw new Error('창업 공고의 공식 URL·ID를 확인할 수 없습니다.');
  return { id: `kstartup-${row.pbanc_sn}`, title: plainText(row.biz_pbanc_nm), summary: plainText(row.pbanc_ctnt),
    agency: plainText(row.pbanc_ntrp_nm), agencyType: '창업지원 공고 제공기관', region: null, category: 'business', topics: ['business'],
    audience: plainText(row.aply_trgt), target: plainText(row.aply_trgt_ctnt), criteria: plainText(row.aply_excl_trgt_ctnt),
    support: plainText(row.supt_biz_clsfc), application: '공식 공고의 접수 방법과 첨부 서식을 확인하세요.',
    deadline: `${plainText(row.pbanc_rcpt_bgng_dt)} ~ ${plainText(row.pbanc_rcpt_end_dt)} (마감 시각은 원문 확인)`,
    contact: plainText(row.prch_cnpl_no), url: url.href, sourceTitle: 'K-Startup 사업공고 API',
    accepting: row.rcrt_prgs_yn === 'Y', endDate: plainText(row.pbanc_rcpt_end_dt),
    checks: [`공식 지원지역: ${plainText(row.supt_regin) || '원문 확인'}`, `연령: ${plainText(row.biz_trgt_age) || '원문 확인'}`, `업력: ${plainText(row.biz_enyy) || '원문 확인'}`, '기업·기관 전용 여부 및 첨부파일의 제외조건 확인'],
  };
}

export async function syncAnnouncements({ key, fetcher = fetch, onProgress } = {}) {
  if (!key) throw new Error('창업 공고 API 인증키가 없습니다.');
  const items = [], ids = new Set(); let expected;
  for (let page = 1; expected === undefined || items.length < expected; page++) {
    const url = new URL('https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01');
    url.search = new URLSearchParams({ serviceKey: decodeURIComponent(key), page: String(page), perPage: '1000', returnType: 'json' });
    let response;
    try { response = await fetcher(url, { signal: AbortSignal.timeout(30000) }); } catch { throw new Error('창업 공고 API 연결 실패. 기존 자료를 유지합니다.'); }
    if (!response.ok) throw new Error(`창업 공고 API 응답 오류 (${response.status})`);
    const body = await response.json();
    if (!Number.isSafeInteger(body.totalCount) || body.totalCount < 1 || body.totalCount > 100000 || body.page !== page || !body.data?.length || body.currentCount !== body.data.length || (expected !== undefined && expected !== body.totalCount)) throw new Error('창업 공고 페이지·건수가 일치하지 않습니다.');
    expected = body.totalCount;
    for (const row of body.data) { const item = normalizeAnnouncement(row); if (ids.has(item.id)) throw new Error('창업 공고 ID 중복'); ids.add(item.id); items.push(item); }
    if (items.length > expected) throw new Error('창업 공고 전체 건수 초과');
    onProgress?.(items.length, expected);
  }
  return { checkedAt: new Date().toISOString().slice(0, 10), sourceTitle: 'K-Startup 사업공고', sourceUrl: 'https://www.data.go.kr/data/15125364/openapi.do', coverage: { expected, imported: items.length, complete: true }, items };
}
