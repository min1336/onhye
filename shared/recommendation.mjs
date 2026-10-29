import { evaluateRegion } from './region.mjs';
import { evaluateEligibility } from '../server/eligibility.mjs';
import { categories } from './topics.mjs';
const topicKeys = Object.keys(categories);
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
export const koreanDate = (date = new Date()) => dateFormatter.format(date);

export function recommendationFocus(topics, profile, preferredTopics = []) {
  if (topics.length) return [...new Set(topics)];
  if (preferredTopics.length) return [...new Set(preferredTopics)];
  if (profile.employment === 'seeking') return ['employment'];
  if (profile.employment === 'student') return ['education'];
  if (profile.special?.includes('JA1101')) return ['business'];
  return [];
}
export function isClosed(item, asOf = koreanDate()) {
  const end = item.endDate?.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  return item.accepting === false || Boolean(end && `${end[1]}-${end[2]}-${end[3]}` < asOf);
}
function guideApplies(guide, profile, focus) {
  if (!guide || !guide.topics.some(topic => focus.includes(topic))) return false;
  if (guide.specialSignal && !profile.special?.includes(guide.specialSignal)) return false;
  if (guide.employmentSignal && profile.employment !== 'unknown' && profile.employment !== guide.employmentSignal) return false;
  if (guide.housingGoals && profile.housingGoal && profile.housingGoal !== 'unknown' && !guide.housingGoals.includes(profile.housingGoal)) return false;
  if (guide.maxChildAge !== undefined && profile.childAge !== null && profile.childAge !== undefined && profile.childAge > guide.maxChildAge) return false;
  return true;
}
export function recommend(items, topics, profile, preferredTopics = [], includeOtherRegions = false) {
  const unique = topics.length ? [...new Set(topics)] : topicKeys;
  const groupOrder = { matched: 0, unknown: 1, outside: 2 };
  const focus = recommendationFocus(topics, profile, preferredTopics), asOf = koreanDate();
  return items.filter(item => (item.topics || [item.category]).some(key => unique.includes(key)) && (includeOtherRegions || !evaluateRegion(item, profile).excluded)).map(item => {
    const evaluation = evaluateEligibility(item, profile), guide = item.programGuide;
    const closed = isClosed(item, asOf);
    const exception = evaluation.missing.some(text => text.includes('지역 이전·예외'));
    const guided = guideApplies(guide, profile, focus);
    const directTopicScore = focus.reduce((score, key) => score + (categories[key].words.test(item.title) ? 2 : 0) + (categories[key].words.test(item.summary || '') ? 1 : 0), 0);
    const relevant = guide ? guided : directTopicScore > 0;
    const notes = [...evaluation.outside.map(text => `${text} · 예외·가족 신청 여부는 공식 안내 확인`)];
    if (closed) notes.push('수집 시 모집 종료 또는 공개 마감일 경과 공고입니다. 재공고·연장 여부를 확인하세요.');
    if (item.region) notes.push(`${item.region} 소관기관 제도입니다. 시·군·구와 실제 거주·사업장·이용지역 조건을 확인하세요.`);
    if ((item.id === 'basic-pension' || item.title === '기초연금') && profile.age !== null && profile.age < 65) notes.push('65세 미만: 가족 검색 또는 신청 가능 시기 확인');
    const context = focus.filter(key => guided ? guide.topics.includes(key) : categories[key].words.test(`${item.title} ${item.summary || ''}`)).map(key => categories[key].label);
    const reason = `${preferredTopics.some(key => context.includes(categories[key].label)) ? '대화에서 확인한 관심 분야입니다. ' : ''}${context.length ? `${context.join('·')} 관심 분야와 관련된 후보입니다. ` : '전체 목록 탐색 후보입니다. '}${profile.employment === 'seeking' && context.includes(categories.employment.label) ? '입력한 구직 상황을 우선 반영했습니다. ' : ''}자격·접수 가능 여부는 공식 조건 확인이 필요합니다.`;
    return { ...item, ...evaluation, notes, closed, exception, guided, relevant, directTopicScore, reason,
      matchScore: evaluation.matched.length - evaluation.missing.length * 2,
      sourceChecks: item.sourceChecks || item.checks || [],
      checks: [...new Set([...evaluation.missing, ...(item.sourceChecks || item.checks || [])])],
      status: { matched: '확인한 입력조건 일치 · 최종 자격 미확정', unknown: '필수정보·조건 확인 필요', outside: '확인한 조건 불일치 · 예외 확인' }[evaluation.group] };
  }).sort((a, b) => Number(a.group === 'outside') - Number(b.group === 'outside') || Number(a.closed) - Number(b.closed) || Number(a.exception) - Number(b.exception) || Number(b.relevant) - Number(a.relevant) || Number(b.guided) - Number(a.guided) || groupOrder[a.group] - groupOrder[b.group] || b.directTopicScore - a.directTopicScore || b.matchScore - a.matchScore || Number(b.region === profile.region) - Number(a.region === profile.region) || (b.popularity || 0) - (a.popularity || 0));
}
const followUpLabels = { age: '지원받을 분의 만 나이', region: '거주 시·도', district: '거주 시·군·구', employment: '현재 취업·재학 상태', householdSize: '함께 사는 가구원 수', incomeBracket: '알고 있는 가구 소득 구간', recipient: '기초생활수급·차상위 여부', crisis: '실직·질병 등 위기상황 여부', childAge: '함께 찾는 아이의 만 나이', housingGoal: '월세·전세보증금·주택구입 중 필요한 도움' };
export function shortlistRecommendations(candidates, topics, profile, preferredTopics = []) {
  const focus = recommendationFocus(topics, profile, preferredTopics), seen = new Set();
  const eligible = focus.length ? candidates.filter(item => item.group !== 'outside' && !item.closed && !item.exception && item.relevant && item.contentLevel !== 'public-list' && (!item.programGuide || item.guided)) : [];
  const guided = eligible.filter(item => item.guided);
  const items = (guided.length ? guided : eligible).filter(item => {
    const key = item.programGuide?.groupKey || item.title.replace(/[\s·()[\]ⅠⅡ]/g, '');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 5);
  const usesAdultAge = !items.length || items.some(item => !['child', 'manual'].includes(item.programGuide?.ageBasis));
  const fields = focus.length ? [...(usesAdultAge ? ['age'] : []), 'region', ...(focus.includes('housing') ? ['housingGoal'] : []), ...items.flatMap(item => (item.programGuide?.fields || []).filter(field => ['employment', 'childAge', 'district'].includes(field) || (field === 'recipient' && item.missing.some(text => text.startsWith('필수:') && text.includes('수급')))))] : ['topics'];
  const followUps = [...new Set(fields)].filter(field => field === 'topics' || profile[field] === null || profile[field] === undefined || profile[field] === '' || profile[field] === 'unknown').slice(0, 3).map(field => ({ field, label: field === 'topics' ? '찾아볼 관심 분야를 먼저 골라 주세요' : followUpLabels[field] }));
  return { items, focus, followUps, explanation: `${guided.length ? '수집 원문의 확인 질문을 정리한 주요 제도에서' : '관심 분야와 입력 상황에 관련된 전체 목록에서'} 최대 5개를 먼저 보여드립니다. 자격·모집 여부는 미확정이며, 다른 제도와 예외는 전체 탐색에서 확인할 수 있어요.` };
}
