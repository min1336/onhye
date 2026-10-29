import { readFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
export async function readSnapshot(name) {
  if (process.env.VERCEL) return JSON.parse(gunzipSync(await readFile(new URL('../.deploy-data/' + name + '.gz', import.meta.url))).toString('utf8'));
  return JSON.parse(await readFile(new URL('../data/' + name, import.meta.url), 'utf8'));
}
export async function channelFiles() {
  if (process.env.VERCEL) return JSON.parse(await readFile(new URL('../.deploy-data/channels-manifest.json', import.meta.url), 'utf8'));
  try { return await readdir(new URL('../data/channels/', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; return []; }
}
