import { evaluateRegion } from '../../shared/region.mjs';
import { evaluateEligibility } from './baseline-eligibility.mjs';
import { categories } from '../../shared/topics.mjs';
const topicKeys = Object.keys(categories);

export function recommend(items, topics, profile, preferredTopics = [], includeOtherRegions = false) {
  const unique = topics.length ? [...new Set(topics)] : topicKeys;
  const groupOrder = { matched: 0, unknown: 1, outside: 2 };
  const focus = topics.length ? topics : preferredTopics;
  return items.filter(item => (item.topics || [item.category]).some(key => unique.includes(key)) && (includeOtherRegions || !evaluateRegion(item, profile).excluded)).map(item => {
    const evaluation = evaluateEligibility(item, profile);
    const notes = [...evaluation.outside.map(text => `${text} · 예외·가족 신청 여부는 공식 안내 확인`)];
    if (item.accepting === false) notes.push('수집 시점 모집 종료 공고입니다. 재공고·연장 여부를 확인하세요.');
    if (item.region) notes.push(`${item.region} 소관기관 제도입니다. 시·군·구와 실제 거주조건을 확인하세요.`);
    if ((item.id === 'basic-pension' || item.title === '기초연금') && profile.age !== null && profile.age < 65) notes.push('65세 미만: 가족 검색 또는 신청 가능 시기 확인');
    const directTopicScore = focus.reduce((score, key) => score + (categories[key].words.test(item.title) ? 2 : 0) + (categories[key].words.test(item.summary || '') ? 1 : 0), 0);
    const priority = preferredTopics.some(key => categories[key].words.test(`${item.title} ${item.summary || ''}`));
    return { ...item, ...evaluation, notes, directTopicScore, matchScore: (priority ? 5 : 0) + evaluation.matched.length - evaluation.missing.length * 2,
      reason: `${topics.length && directTopicScore ? '선택한 분야가 제도명·요약에 명시되어 있습니다. ' : ''}${priority ? '대화에서 찾은 관심 분야입니다. ' : ''}입력조건 비교 결과이며, 미검증 조건과 기관 심사는 남아 있습니다.`,
      sourceChecks: item.sourceChecks || item.checks,
      checks: [...new Set([...evaluation.missing, ...(item.sourceChecks || item.checks)])],
      status: { matched: '확인한 입력조건 일치 · 최종 자격 미확정', unknown: '필수정보·조건 확인 필요', outside: '확인한 조건 불일치 · 예외 확인' }[evaluation.group] };
  }).sort((a, b) => Number(a.group === 'outside') - Number(b.group === 'outside') || Number(b.directTopicScore > 0) - Number(a.directTopicScore > 0) || groupOrder[a.group] - groupOrder[b.group] || Number(a.accepting === false) - Number(b.accepting === false) || b.matchScore - a.matchScore || b.directTopicScore - a.directTopicScore || Number(b.region === profile.region) - Number(a.region === profile.region) || (b.popularity || 0) - (a.popularity || 0));
}
