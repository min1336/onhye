import { recommend as baselineRecommend } from '../research/evaluation/baseline-recommendation.mjs';
import { shortlistRecommendations } from '../shared/recommendation.mjs';
import assert from 'node:assert/strict';
import { programGuide } from '../server/program-guides.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readSnapshot, channelFiles } from '../server/snapshots.mjs';
import { recommend, Profile } from '../server/domain.mjs';
const catalog = await readSnapshot('benefits.json'), announcements = await readSnapshot('announcements.json');
const sources = (await readSnapshot('channels.json')).sources;
for (const file of await channelFiles()) { const source = await readSnapshot('channels/' + file), id = file.replace('.json', ''); if (!sources[id] || source.checkedAt > sources[id].checkedAt) sources[id] = source; }
const items = [...catalog.items, ...announcements.items, ...Object.values(sources).flatMap(source => source.items)].filter(item => item.accepting !== false);
for (const item of items) { const guide = programGuide(item); if (guide) item.programGuide = guide; }
const cases = JSON.parse(await readFile(new URL('../research/evaluation/relevance-cases.json', import.meta.url))).cases;
const baseline = process.argv.includes('--baseline');
const rows = cases.map(example => {
  // The baseline lacks childAge/housingGoal. It receives only fields its public schema supported.
  const { childAge, housingGoal, ...original } = example.profile;
  const profile = baseline ? { ...Profile.parse(original), childAge: undefined, housingGoal: undefined } : Profile.parse(example.profile);
  const ranked = (baseline ? baselineRecommend : recommend)(items, example.topics, profile);
  const top = baseline ? ranked.slice(0, 5) : shortlistRecommendations(ranked, example.topics, profile).items;
  assert.ok(top.length <= 5);
  assert.equal(new Set(top.map(item => item.id)).size, top.length);
  if (!baseline) assert.ok(top.every(item => item.group !== 'outside' && !item.closed && !item.exception));
  return { id: example.id, expectedIds: example.expectedIds, top: top.map(item => ({ id: item.id, title: item.title, group: item.group })), hit: top.some(item => example.expectedIds.includes(item.id)) };
});
const result = { generatedAt: new Date().toISOString(), kind: 'self-authored-development-set', candidateCount: items.length,
  snapshotHash: createHash('sha256').update(JSON.stringify(items.map(item => [item.id,item.target,item.criteria]))).digest('hex'),
  caseCount: rows.length, targetHitAt5: rows.filter(row => row.hit).length / rows.length, rows,
  limitation: '자체 작성한 목표 후보 집합의 노출률이다. 수급자격 정확도·독립 평가·실사용자 성과·AI 모델 정확도가 아니다.' };
const file = new URL(`../research/evaluation/${baseline ? 'baseline' : 'current'}.json`, import.meta.url);
if (baseline) {
  const frozen = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(rows.map(row => row.top.map(item => item.id)), frozen.rows.map(row => row.top.map(item => item.id)), 'Frozen baseline no longer reproduces');
  console.log('Frozen baseline reproduced');
  process.exit(0);
}
await writeFile(file, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ caseCount: result.caseCount, targetHitAt5: result.targetHitAt5, failed: rows.filter(row=>!row.hit).map(row=>row.id) }));
