import { mkdir, stat, rm, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function acquireMonitorLock(directory) {
  const lock = new URL('monitor.lock/', directory);
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await stat(lock).then(s => Date.now() - s.mtimeMs < 300000).catch(() => true)) return null;
    throw new Error('모니터 잠금이 5분 이상 남아 있습니다. 실행 중인 프로세스 확인 후 monitor.lock 디렉터리를 제거하세요.');
  }
  return () => rm(lock, { recursive: true, force: true });
}
export async function writeMonitorState(directory, result) {
  const temporary = new URL(`latest.${randomUUID()}.tmp`, directory);
  try {
    await writeFile(temporary, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, new URL('latest.json', directory));
  } finally { await rm(temporary, { force: true }); }
}
