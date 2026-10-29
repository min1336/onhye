import { REGIONS } from './topics.mjs';

export const regionNames = { '전남광주통합특별시': '전남광주', '서울특별시': '서울', '경기도': '경기', '인천광역시': '인천', '부산광역시': '부산', '대구광역시': '대구', '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종', '강원특별자치도': '강원', '강원도': '강원', '충청북도': '충북', '충청남도': '충남', '전북특별자치도': '전북', '전라북도': '전북', '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주' };

export function parseRegion(text = '') {
  const name = Object.keys(regionNames).find(name => text.startsWith(name));
  if (name) return { region: regionNames[name], rest: text.slice(name.length).trim() };
  const short = REGIONS.find(region => text === region || text.startsWith(region + ' '));
  return { region: short || null, rest: short ? text.slice(short.length).trim() : text };
}
const districts = text => [...text.matchAll(/(?:^|\s)([가-힣]+[시군구])(?=\s|$)/g)].map(match => match[1]);

export function evaluateRegion(item, profile) {
  const target = item.target || '';
  const business = item.regionBasis === 'business' || /(?:소재|소재지|사업장|본점).{0,30}(?:기업|사업자|창업)|(?:기업|사업자|본점).{0,30}(?:소재|소재지)/.test(target);
  if (business) {
    if (!profile.businessRegion || profile.businessRegion === 'unknown') return { excluded: false, missing: ['사업장 소재 시·도 및 실제 지원지역 확인'], matched: [] };
    profile = { ...profile, region: profile.businessRegion, district: profile.businessDistrict || '' };
  }
  const agency = parseRegion(item.agency || '');
  const scope = (item.sourceChecks || item.checks || []).find(check => check.startsWith('공식 지원지역: '))?.slice('공식 지원지역: '.length).trim();
  const scopeTokens = (scope || '').split(/[,·/|\s]+/).filter(Boolean);
  const scopeNationwide = scopeTokens.includes('전국');
  const scopeRegions = scopeTokens.map(text => parseRegion(text).region);
  const scopeKnown = scopeTokens.length && scopeRegions.every(Boolean);
  const local = ['시군구', '광역시도'].includes(item.agencyType) || Boolean(agency.region) || /관내|지역\s*주민|[시군구도]민/.test(target);
  const nationwide = /^(?:○\s*)?(?:국민\s*누구나|전\s*국민|모든\s*국민)[.!]?$/.test(target.trim()) || /지역\s*제한\s*없/.test(target);
  // shortcut: 이전 가능·복수 지역·예외 조건은 거주지만으로 탈락시키지 않고 원문 확인으로 남긴다.
  const portable = /(?:전입|이전).{0,12}(?:예정|(?<!불)가능)|(?:사업장|사업자).{0,8}등록.{0,8}예정|(?:예정|(?<!불)가능).{0,8}(?:전입|이전)|(?:타지역|관외).{0,8}(?:(?<!불)가능|포함)/.test(target);
  if (nationwide) return { excluded: false, missing: [], matched: [] };
  if (portable) return { excluded: false, missing: ['지역 이전·예외 조건: 사업장·전입 예정지와 공식 지원지역 확인'], matched: [] };
  const regions = scopeKnown && !scopeNationwide ? [...new Set(scopeRegions)] : !scope && local && (agency.region || item.region) ? [agency.region || item.region] : [];
  const requiredDistricts = local && !scope ? districts(agency.rest) : [];
  const supplied = parseRegion(profile.district || '').rest;
  const suppliedDistricts = districts(supplied);
  if (!suppliedDistricts.length && /^[가-힣]{2,12}$/.test(supplied) && !/[동읍면리]$/.test(supplied)) suppliedDistricts.push(supplied);
  const sameDistrict = (a, b) => a === b || (!/[시군구]$/.test(b) && a.slice(0, -1) === b);
  if (profile.region !== 'unknown' && regions.length && !regions.includes(profile.region)) return { excluded: true, missing: [], matched: [] };
  if (requiredDistricts.length && suppliedDistricts.length && requiredDistricts.some((name, index) => suppliedDistricts[index] && !sameDistrict(name, suppliedDistricts[index]))) return { excluded: true, missing: [], matched: [] };
  const missing = [], matched = [];
  if (regions.length && profile.region === 'unknown') missing.push('거주 시·도');
  if (requiredDistricts.length && requiredDistricts.some((name, index) => !sameDistrict(name, suppliedDistricts[index]))) missing.push(`실제 지원지역이 ${requiredDistricts.join(' ')}인지 확인`);
  if (!regions.length && !requiredDistricts.length) missing.push('실제 지원지역 미검증: 공식 대상조건 확인');
  else if (!missing.length) matched.push(business ? '확인한 지원지역과 입력 사업장지역 일치' : '확인한 지원지역과 입력 거주지역 일치');
  return { excluded: false, missing, matched };
}
