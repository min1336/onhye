import { API_ROUTES } from '../shared/telemetry.mjs';
import { logEvent, newRequestId } from '../server/observability.mjs';
import { ipAddress } from '@vercel/functions';
import { checkBotId } from 'botid/server';
import { createApplication, HttpError } from '../server/index.mjs';
import { createFirestoreGuard } from '../server/firestore-guard.mjs';
import { getGoogleClient } from '../server/google-auth.mjs';
let application;
async function loadApplication() {
  process.env.PUBLIC_ORIGIN = process.env.VERCEL_ENV === 'production' ? 'https://onhye.vercel.app' : 'https://' + process.env.VERCEL_URL;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  let guard = null;
  try { guard = createFirestoreGuard({ project, secret: process.env.AI_SESSION_SECRET, client: await getGoogleClient(project) }); }
  catch (error) { logEvent('shared_store_failed', { error }); }
  return createApplication({ frontend: false, guard, requireSharedRate: true, clientIp: req => ipAddress(new Headers(Object.entries(req.headers).filter(([, value]) => typeof value === 'string'))) || req.socket.remoteAddress, botCheck: async () => {
    const result = await checkBotId({ developmentOptions: { isDevelopment: false }, advancedOptions: { checkLevel: 'basic' } });
    if (!result.isHuman || result.isBot || result.isVerifiedBot || result.bypassed) throw new HttpError(403, '자동 요청을 확인했어요. 직접 분야를 선택하거나 브라우저에서 다시 시도해 주세요.');
  } });
}
export function platformRequestUrl(requestUrl) {
  const url = new URL(requestUrl, 'http://localhost');
  // Vercel appends an unused named rewrite capture as a query parameter.
  if (API_ROUTES.includes(url.pathname) && url.searchParams.getAll('path').length === 1 && url.searchParams.get('path') === url.pathname.slice('/api/'.length)) url.searchParams.delete('path');
  return url.pathname + url.search;
}
export default async function handler(req, res) {
  try {
    req.url = platformRequestUrl(req.url);
    application ||= loadApplication().catch(error => { application = null; throw error; });
    const app = await application;
    return await app.handler(req, res);
  } catch (error) {
    const requestId = newRequestId();
    logEvent('application_failed', { requestId, error, status: 503 });
    if (res.headersSent) { res.end(); return; }
    res.setHeader('X-Request-ID', requestId);
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: '상담 서버를 준비하고 있어요. 잠시 후 다시 시도해 주세요.' }));
  }
}
