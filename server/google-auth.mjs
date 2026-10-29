import { GoogleAuth, ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
let federatedClient;
export async function getGoogleClient(project) {
  if (!process.env.VERCEL) {
    const client = await new GoogleAuth({ projectId: project, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
    client.quotaProjectId = project; return client;
  }
  const { GCP_PROJECT_NUMBER, GCP_SERVICE_ACCOUNT_EMAIL, GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID } = process.env;
  if (!GCP_PROJECT_NUMBER || !GCP_SERVICE_ACCOUNT_EMAIL || !GCP_WORKLOAD_IDENTITY_POOL_ID || !GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID) throw new Error('Cloud federation configuration missing');
  federatedClient ||= ExternalAccountClient.fromJSON({ type: 'external_account', audience: `//iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`, subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', token_url: 'https://sts.googleapis.com/v1/token', service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`, subject_token_supplier: { getSubjectToken: getVercelOidcToken }, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return federatedClient;
}
