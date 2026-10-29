import { getGoogleClient } from '../server/google-auth.mjs';
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (project !== 'gen-lang-client-0179618980') throw new Error('승인된 기존 프로젝트와 다릅니다.');
const number = '586413418036', team = 'aldursjrnf123-4009s-projects', projectId = 'prj_HSrkuQRyxI44lR3XxiIHQaSt6IXR';
const client = await getGoogleClient(project);
const request = async (url, method = 'GET', data) => { try { return (await client.request({ url, method, data, retry: false, timeout: 30000 })).data; } catch (error) { error.operation = method + ' ' + new URL(url).pathname; throw error; } };
const ensure = async (url, createUrl, body) => {
  try { return await request(url); } catch (error) { if (error.response?.status !== 404) throw error; }
  return request(createUrl, 'POST', body);
};
try {
  const sa = `onhye-vercel@${project}.iam.gserviceaccount.com`, saUrl = `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${sa}`;
  await ensure(saUrl, `https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`, { accountId: 'onhye-vercel', serviceAccount: { displayName: 'Onhye Vercel runtime' } });
  const role = `projects/${project}/roles/onhyeRuntime`;
  await ensure(`https://iam.googleapis.com/v1/${role}`, `https://iam.googleapis.com/v1/projects/${project}/roles`, { roleId: 'onhyeRuntime', role: { title: 'Onhye runtime minimal permissions', stage: 'GA', includedPermissions: ['aiplatform.endpoints.predict', 'datastore.entities.get', 'datastore.entities.create', 'datastore.entities.update', 'datastore.databases.getMetadata', 'serviceusage.services.use'] } });
  const policyUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
  const policy = await request(policyUrl + ':getIamPolicy', 'POST', { options: { requestedPolicyVersion: 3 } });
  const member = 'serviceAccount:' + sa;
  let binding = policy.bindings.find(row => row.role === role && !row.condition);
  if (!binding) { binding = { role, members: [] }; policy.bindings.push(binding); }
  if (!binding.members.includes(member)) { binding.members.push(member); await request(policyUrl + ':setIamPolicy', 'POST', { policy }); }
  const parent = `projects/${number}/locations/global`, pool = parent + '/workloadIdentityPools/onhye-vercel';
  await ensure(`https://iam.googleapis.com/v1/${pool}`, `https://iam.googleapis.com/v1/${parent}/workloadIdentityPools?workloadIdentityPoolId=onhye-vercel`, { displayName: 'Onhye Vercel' });
  await ensure(`https://iam.googleapis.com/v1/${pool}/providers/vercel`, `https://iam.googleapis.com/v1/${pool}/providers?workloadIdentityPoolProviderId=vercel`, { displayName: 'Onhye Vercel OIDC', attributeMapping: { 'google.subject': 'assertion.sub', 'attribute.project_id': 'assertion.project_id' }, attributeCondition: `assertion.owner_id == 'team_DPQqeZMs16Va7XvkSMsSbbOr' && assertion.project_id == '${projectId}' && assertion.environment in ['production', 'preview']`, oidc: { issuerUri: 'https://oidc.vercel.com/' + team, allowedAudiences: ['https://vercel.com/' + team] } });
  const saPolicy = await request(saUrl + ':getIamPolicy', 'POST', {});
  const principal = `principalSet://iam.googleapis.com/${pool}/attribute.project_id/${projectId}`;
  saPolicy.bindings ||= [];
  let delegation = saPolicy.bindings.find(row => row.role === 'roles/iam.workloadIdentityUser' && !row.condition);
  if (!delegation) { delegation = { role: 'roles/iam.workloadIdentityUser', members: [] }; saPolicy.bindings.push(delegation); }
  if (!delegation.members.includes(principal)) { delegation.members.push(principal); await request(saUrl + ':setIamPolicy', 'POST', { policy: saPolicy }); }
  const databaseUrl = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`;
  const database = await ensure(databaseUrl, `https://firestore.googleapis.com/v1/projects/${project}/databases?databaseId=(default)`, { locationId: 'asia-northeast3', type: 'FIRESTORE_NATIVE' });
  console.log(JSON.stringify({ serviceAccount: sa, role, pool, database: database.name, type: database.type || 'creation requested' }));
} catch (error) { console.error(JSON.stringify({ operation: error.operation, status: error.response?.status, error: error.response?.data?.error?.message || 'Cloud setup failed' })); process.exitCode = 1; }
