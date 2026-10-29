import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { EXTRA_SOURCES } from '../shared/sources.mjs';
import { collectArko, collectMss, collectSeoul, collectKosaf, collectYouth, collectMyhome, collectIris, collectSbiz, collectBizinfo, collectWork, collectMssApi } from '../server/channels.mjs';
const collectors = { work: collectWork, sbiz: collectSbiz, bizinfo: collectBizinfo, youth: collectYouth, myhome: collectMyhome, iris: collectIris, arko: collectArko, mss: process.env.MSS_API_KEY || process.env.WELFARE_API_KEY ? collectMssApi : collectMss, seoul: collectSeoul, kosaf: collectKosaf };
const sourceTitles = { work: '고용24', sbiz: '소상공인24', bizinfo: '기업마당', youth: '온통청년', myhome: '마이홈', iris: 'IRIS', arko: '아르코', mss: '중소벤처기업부', seoul: '서울 청년몽땅정보통', kosaf: '한국장학재단' };
const target = new URL('../data/channels.json', import.meta.url);
let previous; try { previous = JSON.parse(await readFile(target, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; previous = { sources: {} }; }
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(collectors)) {
  const match = EXTRA_SOURCES.find(s => s.title === sourceTitles[id]);
  if (!collectors[id] || !match) throw new Error('알 수 없는 채널');
  const source = { ...match, id };
  try {
    const result = await collectors[id](source, (n, total) => console.log(`${source.title} ${n}/${total}`));
    if (new Set(result.items.map(x => x.id)).size !== result.items.length) throw new Error('고유 ID 중복');
    previous.sources[id] = { title: source.title, url: source.url, checkedAt: new Date().toISOString(), complete: result.complete ?? true, imported: result.items.length, expected: result.expected, scope: result.scope, sourceRecords: result.sourceRecords, items: result.items };
    await mkdir(new URL('../data/channels/', import.meta.url), { recursive: true });
    const pending = new URL(`../data/channels/${id}.pending.json`, import.meta.url);
    await writeFile(pending, JSON.stringify(previous.sources[id]) + '\n'); await rename(pending, new URL(`../data/channels/${id}.json`, import.meta.url));
    console.log(`${source.title} 실제 반영 ${result.items.length}건`);
  } catch (error) { console.error(`${source.title}: ${error.message}; 기존 수집본 유지`); process.exitCode = 1; }
}

await import('./pack-deployment.mjs');
