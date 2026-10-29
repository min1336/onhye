import { evaluateRegion } from '../../shared/region.mjs';
import { SPECIAL } from '../../shared/profile.mjs';
// shortcut: 금액 규칙은 출처를 확인한 2026년 서울형 긴급복지 1인 가구만 지원한다.
export const FINANCIAL_SOURCE = 'https://www.gwanak.go.kr/site/gwanak/04/10403020000002016051204.jsp';
export function evaluateEligibility(item, profile, asOf = new Date().toISOString().slice(0, 10)) {
  const matched = [], missing = [], outside = [];
  const c = item.conditions || {};
  if (profile.age === null) missing.push('지원받을 분의 정확한 나이');
  else if (Number.isFinite(c.JA0110) && Number.isFinite(c.JA0111)) {
    const text = `공식 연령 범위 ${c.JA0110}~${c.JA0111}세`;
    (profile.age >= c.JA0110 && profile.age <= c.JA0111 ? matched : outside).push(text);
  }
  const target = item.target || '';
  const unrestricted = /^(?:○\s*)?(?:지역\s*주민\s*모두|국민\s*누구나|전\s*국민|모든\s*국민)[.!]?$/.test(target.trim()) && !item.criteria;
  if (!unrestricted) missing.push('대상·선정·제외조건 전체 미검증: 공식 안내 확인 필요');
  const recipientOnly = /^\s*[○ㅇ-]?\s*기초(?:생계|생활|의료)/.test(target) && !/제외|해당하지|비수급/.test(target);
  if (recipientOnly) {
    const nearAllowed = /차상위/.test(target);
    if (!profile.recipient || profile.recipient === 'unknown') missing.push(`필수: ${nearAllowed ? '기초생활수급·차상위' : '해당 기초생활급여 수급'} 여부`);
    else if (profile.recipient === 'none' || (profile.recipient === 'near' && !nearAllowed)) outside.push('수급자 전용 대상조건과 입력이 다름');
    else missing.push('수급 급여 종류와 해당 사업 대상의 일치 확인');
  }
  const financialCondition = /소득|재산|건강보험료/.test(`${target} ${item.criteria || ''}`);
  if (financialCondition && item.id !== 'gov24-611000000149') missing.push('필수: 소득·재산 등 상세 선정기준 미검증');
  const geography = evaluateRegion(item, profile);
  missing.push(...geography.missing);
  matched.push(...geography.matched);
  if (geography.excluded) outside.push('확인한 지원지역과 거주지역 불일치');
  // 모두 Y인 범용 대상 표시는 개인별 적합도 점수로 쓰지 않는다.
  const sex = { male: 'JA0101', female: 'JA0102' }[profile.sex];
  if (sex && c[sex] === 'Y' && !(c.JA0101 === 'Y' && c.JA0102 === 'Y')) matched.push('성별 대상 표시 일치');
  if (c.JA0326 !== c.JA0327) {
    const job = { seeking: 'JA0327', employed: 'JA0326' }[profile.employment];
    if (job && c[job] === 'Y') matched.push('직업 대상 표시 일치');
  }
  for (const key of profile.special || []) if (c[key] === 'Y' && !Object.keys(SPECIAL).filter(k => k.slice(0, 4) === key.slice(0, 4)).every(k => c[k] === 'Y')) matched.push(`${({ JA0412: '무주택', JA0404: '1인 가구' })[key] || '입력 특성'} 대상 표시 일치`);
  if (item.id === 'gov24-611000000149') {
    missing.push('공식 위기사유·재산 산정·예외 및 접수 심사 확인');
    const size = profile.householdSize ?? (profile.special?.includes('JA0404') ? 1 : null);
    if (!asOf.startsWith('2026-')) missing.push('금액 규칙의 적용연도 경과: 최신 기준 재확인 필요');
    else if (size !== 1) missing.push('금액 자동비교는 2026년 1인 가구 규칙만 검증됨');
    else {
      for (const [key, maximum, label] of [['householdIncome', 2564238, '가구 월소득'], ['householdFinancialAssets', 12564000, '가구 금융재산(생활준비금 포함 공개 기준)']]) {
        if (profile[key] === null || profile[key] === undefined) missing.push(`${label}: 가구 기준 금액 필요`);
        else if (!profile.amountsAssessed) missing.push(`${label}: 제도 산정액인지 확인해야 비교 가능`);
        else (profile[key] <= maximum ? matched : outside).push(`${label} ${maximum.toLocaleString('ko-KR')}원 이하 기준 ${profile[key] <= maximum ? '이내' : '초과'} (2026년·예외 별도)`);
      }
    }
  } else if (financialCondition && Object.keys(profile).some(key => /Income$|Assets$|^debt$/.test(key) && typeof profile[key] === 'number')) missing.push('금액 규칙 미검증: 입력 금액으로 자격을 판정하지 않음');
  if (!item.conditions) missing.push('구조화 대상조건 미제공');
  if (item.audience && /법인|기관|단체/.test(item.audience) && !/개인/.test(item.audience)) missing.push('법인·기관·단체 전용 여부 확인');
  if (profile.region === 'unknown') missing.push('실제 지원지역 확인');
  return { matched, missing: [...new Set(missing)], outside, group: outside.length ? 'outside' : missing.length ? 'unknown' : 'matched', ruleSource: item.id === 'gov24-611000000149' ? FINANCIAL_SOURCE : null };
}
