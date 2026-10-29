import { writeFile, rename, unlink } from 'node:fs/promises';
import { syncAnnouncements } from '../server/announcements.mjs';
const target = new URL('../data/announcements.json', import.meta.url);
const pending = new URL('../data/announcements.pending.json', import.meta.url);
try {
  const data = await syncAnnouncements({ key: process.env.KSTARTUP_API_KEY || process.env.WELFARE_API_KEY, onProgress: (n, total) => console.log(`창업 공고 ${n}/${total}`) });
  await writeFile(pending, JSON.stringify(data) + '\n', { flag: 'wx' });
  await rename(pending, target);
} catch (error) { await unlink(pending).catch(() => {}); console.error('창업 공고 갱신 실패: 기존 자료 유지. 인증·페이지·원문 형식을 확인하세요.'); process.exitCode = 1; }

await import('./pack-deployment.mjs');
