import { rename, writeFile, unlink } from 'node:fs/promises';
import { syncCatalog, attachConditions } from '../server/welfare.mjs';

const target = new URL('../data/benefits.json', import.meta.url);
const temporary = new URL('../data/benefits.pending.json', import.meta.url);
try {
  const next = await syncCatalog({ key: process.env.GOV24_API_KEY, onProgress: (count, total) => console.log(`수집 ${count}/${total}`) });
  await attachConditions(next, { key: process.env.GOV24_API_KEY });
  await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, target);
  console.log(`${next.items.length}개 제도를 API 수집본으로 갱신했습니다. 서버를 재시작하세요.`);
} catch (error) {
  await unlink(temporary).catch(() => {});
  console.error(error.message.includes('serviceKey=') ? '복지 API 수집에 실패했습니다. 기존 자료는 유지됩니다.' : error.message);
  process.exitCode = 1;
}

await import('./pack-deployment.mjs');
