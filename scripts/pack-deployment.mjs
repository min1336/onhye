import { mkdir, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
const root = new URL('../', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestUrl = new URL('.deploy-data/snapshot-hashes.json', root);
if (!process.env.VERCEL && !process.argv.includes('--verify')) {
  const files = (await readdir(new URL('data/channels/', root))).filter(name => /^[a-z]+\.json$/.test(name)).sort();
  await mkdir(new URL('.deploy-data/channels/', root), { recursive: true });
  const hashes = {};
  for (const name of ['benefits.json', 'announcements.json', 'channels.json', ...files.map(name => 'channels/' + name)]) {
    const bytes = Buffer.from(JSON.stringify(JSON.parse(await readFile(new URL('data/' + name, root), 'utf8'))));
    hashes[name] = digest(bytes);
    const destination = new URL('.deploy-data/' + name + '.gz', root), temporary = new URL(destination.href + '.' + randomUUID());
    try { await writeFile(temporary, gzipSync(bytes, { level: 9 })); await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
  }
  await writeFile(new URL('.deploy-data/channels-manifest.json', root), JSON.stringify(files));
  await writeFile(manifestUrl, JSON.stringify(hashes));
}
const hashes = JSON.parse(await readFile(manifestUrl, 'utf8'));
const files = JSON.parse(await readFile(new URL('.deploy-data/channels-manifest.json', root), 'utf8'));
const names = ['benefits.json', 'announcements.json', 'channels.json', ...files.map(name => 'channels/' + name)];
if (JSON.stringify(Object.keys(hashes).sort()) !== JSON.stringify(names.sort())) throw new Error('배포 데이터 목록 불일치');
for (const name of names) {
  const bytes = gunzipSync(await readFile(new URL('.deploy-data/' + name + '.gz', root)));
  if (digest(bytes) !== hashes[name]) throw new Error('배포 데이터 해시 불일치: ' + name);
  JSON.parse(bytes.toString('utf8'));
  if (!process.env.VERCEL) {
    const source = Buffer.from(JSON.stringify(JSON.parse(await readFile(new URL('data/' + name, root), 'utf8'))));
    if (digest(source) !== hashes[name]) throw new Error('수집본과 배포본 불일치: ' + name);
  }
}
console.log(`배포 데이터 ${names.length}개 파일 무결성 검증 완료`);
