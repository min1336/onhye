import { regionNames } from '../shared/region.mjs';
import { categories } from '../shared/topics.mjs';

export const WELFARE_SOURCE = 'https://www.data.go.kr/data/15113968/openapi.do';
export function plainText(value) {
  let text = String(value ?? '');
  for (let i = 0; i < 2; i++) text = text.replace(/&(amp|lt|gt|quot|apos|nbsp);|&#(x[0-9a-f]+|[0-9]+);/gi, (match, name, number) => {
    if (name) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name.toLowerCase()];
    const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
  });
  return text.replace(/\\r\\n|\\n/g, ' ').replace(/<\/?(?:p|br|div|span|b|strong|em|i|ul|ol|li|table|tr|td|th|a|h[1-6])\b[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
}

const fieldTopics = {
  '주거·자립': ['housing'], '농림축산어업': ['agriculture'], '행정·안전': ['administration'],
  '문화·환경': ['culture'], '보건·의료': ['health'], '고용·창업': ['employment', 'business'],
  '보육·교육': ['family', 'education'], '생활안정': ['livelihood'], '보호·돌봄': ['care'], '임신·출산': ['family'],
};


export function normalizeBenefit(row) {
  const id = plainText(row['서비스ID']), title = plainText(row['서비스명']);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !title) throw new Error('서비스 ID 또는 제도명이 없어 갱신을 중단했습니다.');
  const link = new URL(plainText(row['상세조회URL']));
  if (link.protocol !== 'https:' || !['gov.kr', 'www.gov.kr'].includes(link.hostname)) throw new Error('정부24 공식 상세 링크를 확인할 수 없습니다.');
  const field = plainText(row['서비스분야']);
  const topics = [...new Set([...(fieldTopics[field] || []), ...Object.keys(categories).filter(key => categories[key].words.test(title))])];
  if (!topics.length) topics.push('other');
  const agency = plainText(row['소관기관명']);
  const region = Object.entries(regionNames).find(([name]) => agency.startsWith(name))?.[1] || null;
  return {
    id: `gov24-${id}`, servId: id, title, category: topics[0], topics, field, agency, agencyType: plainText(row['소관기관유형']), region,
    audience: plainText(row['사용자구분']), summary: plainText(row['서비스목적요약']), target: plainText(row['지원대상']),
    criteria: plainText(row['선정기준']), support: plainText(row['지원내용']), application: plainText(row['신청방법']),
    deadline: plainText(row['신청기한']), contact: plainText(row['전화문의']), reception: plainText(row['접수기관']),
    checks: ['공식 지원대상·선정기준', '거주지역·가구·소득·재산 등 개별 조건', '신청기한·중복지원·접수 여부'],
    url: link.href, sourceTitle: '정부24 공공서비스(혜택) API 수집본', updatedAt: plainText(row['수정일시']), popularity: Number(row['조회수']) || 0,
  };
}

export async function fetchBenefitsPage(page, { key, fetcher = fetch, endpoint = 'serviceList' }) {
  let decodedKey;
  try { decodedKey = decodeURIComponent(key); } catch { decodedKey = key; }
  const url = new URL(`https://api.odcloud.kr/api/gov24/v3/${endpoint}`);
  url.search = new URLSearchParams({ page: String(page), perPage: '1000' });
  let response;
  try { response = await fetcher(url, { headers: { Authorization: `Infuser ${decodedKey}` }, signal: AbortSignal.timeout(30000) }); }
  catch { throw new Error('정부24 API에 연결하지 못했습니다. 기존 자료는 유지됩니다.'); }
  if (!response.ok) throw new Error(`정부24 API 응답 오류 (${response.status}). 기존 자료는 유지됩니다.`);
  let body;
  try { body = await response.json(); } catch { throw new Error('정부24 API 응답이 JSON이 아닙니다.'); }
  if (!Number.isSafeInteger(body.totalCount) || body.totalCount < 1 || body.totalCount > 100000 || body.page !== page || !Array.isArray(body.data) || body.data.length === 0 || body.currentCount !== body.data.length) throw new Error('정부24 목록의 페이지·건수를 확인할 수 없습니다.');
  return body;
}

export async function syncCatalog(options) {
  if (!options.key) throw new Error('GOV24_API_KEY가 없습니다. 정부24 API 활용신청·승인 후 실행하세요. 기존 자료는 유지됩니다.');
  const items = [], ids = new Set();
  let expected;
  for (let page = 1; expected === undefined || items.length < expected; page++) {
    const body = await fetchBenefitsPage(page, options);
    if (expected !== undefined && body.totalCount !== expected) throw new Error('수집 중 공식 전체 건수가 변경되어 갱신을 중단했습니다.');
    expected = body.totalCount;
    for (const row of body.data) {
      const item = normalizeBenefit(row);
      if (ids.has(item.id)) throw new Error('페이지 간 중복 서비스 ID가 있어 갱신을 중단했습니다.');
      ids.add(item.id); items.push(item);
    }
    if (items.length > expected) throw new Error('공식 전체 건수보다 많은 항목이 반환됐습니다.');
    options.onProgress?.(items.length, expected);
  }
  const agencyCounts = {};
  for (const item of items) agencyCounts[item.agencyType || '미확인'] = (agencyCounts[item.agencyType || '미확인'] || 0) + 1;
  return { mode: 'api-snapshot', checkedAt: new Date().toISOString().slice(0, 10), sourceTitle: '정부24 공공서비스(혜택)', sourceUrl: WELFARE_SOURCE,
    coverage: { expected, imported: items.length, complete: items.length === expected, agencyCounts, note: '정부24 API가 제공하는 전체 목록입니다. 모든 민간 지원사업이나 현재 신청 가능 여부를 보장하지 않습니다.' },
    description: '정부24 공공서비스 API 전체 목록 수집본입니다. 실시간 자격 확인 결과가 아닙니다.', items };
}

export async function attachConditions(catalog, options) {
  const byId = new Map();
  let expected;
  for (let page = 1; expected === undefined || byId.size < expected; page++) {
    const body = await fetchBenefitsPage(page, { ...options, endpoint: 'supportConditions' });
    if (expected !== undefined && expected !== body.totalCount) throw new Error('지원조건 전체 건수가 수집 중 변경됐습니다.');
    expected = body.totalCount;
    for (const row of body.data) {
      if (!row['서비스ID'] || byId.has(row['서비스ID'])) throw new Error('지원조건 ID가 없거나 중복됩니다.');
      byId.set(row['서비스ID'], Object.fromEntries(Object.entries(row).filter(([key, value]) => /^JA\d+$/.test(key) && value !== null)));
    }
    if (byId.size > expected) throw new Error('지원조건 건수가 일치하지 않습니다.');
  }
  for (const item of catalog.items) if (byId.has(item.servId)) item.conditions = byId.get(item.servId);
  catalog.coverage.conditionImported = catalog.items.filter(item => item.conditions).length;
  return catalog;
}
