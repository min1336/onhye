import { getGoogleClient } from '../server/google-auth.mjs';
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (project !== 'gen-lang-client-0179618980') throw new Error('승인된 기존 프로젝트와 다릅니다.');
try {
const client = await getGoogleClient(project);
const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/onhye_rate_limits/fields/expiresAt`;
const current = (await client.request({ url, retry: false, timeout: 15000 })).data;
if (!['ACTIVE', 'CREATING'].includes(current.ttlConfig?.state)) {
  await client.request({ url: url + '?updateMask=ttlConfig', method: 'PATCH', data: { ttlConfig: {} }, retry: false, timeout: 15000 });
}
const field = (await client.request({ url, retry: false, timeout: 15000 })).data;
console.log(JSON.stringify({ collectionGroup: 'onhye_rate_limits', ttl: field.ttlConfig?.state || 'operation requested' }));

} catch (error) { console.error(JSON.stringify({ operation: 'rate-limit-ttl', status: error.response?.status || null })); process.exitCode = 1; }
