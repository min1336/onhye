import { isClosed, shortlistRecommendations, koreanDate } from '../shared/recommendation.mjs';
import { programGuide } from './program-guides.mjs';
import { logEvent, newRequestId } from './observability.mjs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readSnapshot, channelFiles } from './snapshots.mjs';
import { localGuidance } from '../shared/local-replies.mjs';
import { createAiGuard, verifyBot } from './ai-guard.mjs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AnalyzeInput, RecommendInput, ClientEvent, demoClassify, parseDecisions, recommend } from './domain.mjs';

import { CatalogQuery, cataloguePage } from './catalogue.mjs';
import { redactMoney } from '../shared/profile.mjs';
import { decisionRequest, generateDecisions, GEMINI_MODEL } from './gemini.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function analyze(input, { project, billingConfirmed, model = GEMINI_MODEL, generate = generateDecisions, requestId } = {}) {
  input = AnalyzeInput.parse(input);
  const guidance = localGuidance(input.text);
  if (guidance) return { topics: [], uncertain: [], mode: 'local', model: null, guidance };
  input.text = redactMoney(input.text);
  if (input.mode === 'demo') return { topics: demoClassify(input.text), uncertain: [], mode: 'demo', model: null };
  if (!project || !billingConfirmed) throw new HttpError(503, 'Gemini 연결 대기 중입니다. Google Cloud 프로젝트와 후불 결제 설정이 필요합니다.');
  if (!input.consent) throw new HttpError(400, 'Google Cloud Gemini로 상황 설명을 보내는 데 동의가 필요합니다.');
  let raw;
  try { raw = await generate({ project, model, payload: decisionRequest(input.text) }); }
  catch (error) {
    const status = error.response?.status || error.status;
    logEvent('ai_provider_failed', { requestId, error, upstreamStatus: status });
    const messages = { 401: 'Google Cloud 인증을 확인해 주세요.', 403: 'Google Cloud 프로젝트의 결제·API·접근 권한을 확인해 주세요.', 404: 'Google Cloud 모델 사용 가능 여부를 확인해 주세요.', 429: 'Gemini 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.' };
    throw new HttpError(502, messages[status] || 'Gemini에 연결하지 못했습니다. 자동 재시도는 하지 않았어요.');
  }
  try {
    const candidate = raw.candidates?.[0];
    if (candidate?.finishReason !== 'STOP' || raw.promptFeedback?.blockReason) throw new Error('Incomplete response');
    const text = candidate.content.parts.filter(part => !part.thought).map(part => part.text || '').join('');
    return { ...parseDecisions(JSON.parse(text), input.text), mode: 'gemini', model: raw.modelVersion || model };
  } catch (error) { logEvent('ai_response_invalid', { requestId, error }); throw new HttpError(502, 'Gemini 응답의 형식 또는 근거를 확인할 수 없어 분류를 중단했습니다. 다시 시도하거나 체험 모드를 선택해 주세요.'); }
}

export async function readJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'JSON 형식의 요청이 필요합니다.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 16384) throw new HttpError(413, '입력 내용이 너무 깁니다.');
    chunks.push(bytes);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw new HttpError(400, '요청 형식이 올바르지 않습니다.'); }
}

export async function createApplication({ port = Number(process.env.PORT || 5173), host = process.env.HOST || '127.0.0.1', guardFile = process.env.AI_GUARD_FILE || path.resolve('.private/ai-guard.sqlite'), now = Date.now, ai = {}, frontend = true, requireSharedRate = false, guard: providedGuard, botCheck, clientIp = req => req.socket.remoteAddress } = {}) {
  const catalog = await readSnapshot('benefits.json');
  const announcements = await readSnapshot('announcements.json');
  catalog.announcementCoverage = { ...announcements.coverage, checkedAt: announcements.checkedAt, sourceUrl: announcements.sourceUrl };
  catalog.items.push(...announcements.items);
  let channelSources = {};
  try { channelSources = (await readSnapshot('channels.json')).sources; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let files = [];
  try { files = await channelFiles(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const filename of files.filter(name => /^[a-z]+\.json$/.test(name))) {
    const id = filename.replace('.json', '');
    const source = await readSnapshot('channels/' + filename);
    if (!channelSources[id] || source.checkedAt > channelSources[id].checkedAt) channelSources[id] = source;
  }
  const channelCoverage = [];
  for (const [id, source] of Object.entries(channelSources)) {
    if (!Array.isArray(source.items) || source.items.length !== source.imported || new Set(source.items.map(item => item.id)).size !== source.imported) throw new Error('추가 채널 수집본 무결성 오류');
    catalog.items.push(...source.items);
    const { items, ...metadata } = source;
    channelCoverage.push({ id, ...metadata });
  }
  if (new Set(catalog.items.map(item => item.id)).size !== catalog.items.length) throw new Error('전체 채널 ID 중복');
  for (const item of catalog.items) { const guide = programGuide(item); if (guide) item.programGuide = guide; }
  const byId = new Map(catalog.items.map(item => [item.id, item]));
  const sortedItems = [...catalog.items].sort((a, b) => Number(a.accepting === false) - Number(b.accepting === false) || (b.popularity || 0) - (a.popularity || 0));
  const catalogMetadata = { channelCoverage, additionalCount: channelCoverage.reduce((sum, source) => sum + source.imported, 0), mode: catalog.mode, checkedAt: catalog.checkedAt, sourceTitle: catalog.sourceTitle, sourceUrl: catalog.sourceUrl, coverage: catalog.coverage,
    announcementCoverage: { ...catalog.announcementCoverage, accepting: announcements.items.filter(item => item.accepting).length },
    count: catalog.items.length, agencyTypes: [...new Set(catalog.items.map(item => item.agencyType).filter(Boolean))],
    previews: [catalog.items.find(item => item.title === '국민취업지원제도'), catalog.items.find(item => item.title.startsWith('주거급여'))].filter(Boolean).map(({ id, title, summary, category, agency, url }) => ({ id, title, summary, category, agency, url })) };

  const production = process.env.NODE_ENV === 'production';
  const vite = production || !frontend ? null : await (await import('vite')).createServer({ server: { middlewareMode: true, fs: { deny: ['**/.env*', '**/*.{crt,pem}', '**/.git/**', '**/.private/**', '**/*.{sqlite,sqlite3,db}{,-wal,-shm,-journal}', path.resolve(guardFile).replaceAll('\\', '/') + '{,-wal,-shm,-journal}'] } }, appType: 'spa' });
  const limits = new Map();
  const recommendationCache = new Map();
  const aiConfig = { project: process.env.GOOGLE_CLOUD_PROJECT, billingConfirmed: process.env.GOOGLE_CLOUD_POSTPAY_CONFIRMED === 'true', model: process.env.GEMINI_MODEL || GEMINI_MODEL, ...ai };
  const botRequired = production || !['127.0.0.1', 'localhost', '::1'].includes(host) || Boolean(process.env.PUBLIC_ORIGIN);
  let publicOrigin;
  try { if (process.env.PUBLIC_ORIGIN) { const parsed = new URL(process.env.PUBLIC_ORIGIN); if (parsed.protocol === 'https:' && parsed.origin === process.env.PUBLIC_ORIGIN) publicOrigin = parsed.origin; } } catch {}
  let guard;
  try { guard = providedGuard === undefined ? createAiGuard(guardFile, now) : providedGuard; } catch (error) { logEvent('shared_store_failed', { error }); }
  const ready = Boolean(aiConfig.project && aiConfig.billingConfirmed);
  const available = ready && Boolean(guard) && process.env.AI_ENABLED !== 'false' && (!botRequired || Boolean(publicOrigin && (botCheck || (process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY))));

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    const requestId = newRequestId(), started = performance.now();
    res.setHeader('X-Request-ID', requestId);
    let url;
    res.on('finish', () => {
      if (url?.pathname.startsWith('/api/')) logEvent(res.statusCode >= 400 ? 'request_failed' : 'request_completed', { requestId, route: url.pathname, method: req.method, status: res.statusCode, durationMs: performance.now() - started });
    });
    try { url = new URL(req.url, 'http://localhost'); }
    catch (error) { logEvent('request_exception', { requestId, status: 400, error }); return send(400, { error: '요청 주소가 올바르지 않습니다.' }); }
    if (url.pathname.startsWith('/api/')) {
      try {
        const origins = botRequired ? [publicOrigin, process.env.VERCEL && `https://${process.env.VERCEL_URL}`].filter(Boolean) : [`http://127.0.0.1:${server.address().port}`, `http://localhost:${server.address().port}`, `http://[::1]:${server.address().port}`];
        if (req.headers.origin && !origins.includes(req.headers.origin)) throw new HttpError(403, '다른 사이트에서 보낸 요청은 허용되지 않습니다.');
        const routes = { '/api/status': 'GET', '/api/catalog': 'GET', '/api/catalog-meta': 'GET', '/api/benefit': 'GET', '/api/analyze': 'POST', '/api/recommend': 'POST', '/api/client-events': 'POST' };
        if (!routes[url.pathname]) throw new HttpError(404, '요청한 기능을 찾을 수 없습니다.');
        if (req.method !== routes[url.pathname]) throw new HttpError(405, '지원하지 않는 요청입니다.');
        const time = now();
        for (const [key, value] of limits) if (value.until <= time) limits.delete(key);
        const ip = clientIp(req);
        const limit = limits.get(ip) || { count: 0, routes: {}, until: time + 60000 };
        const routeCount = (limit.routes[url.pathname] || 0) + 1;
        limit.count++; limit.routes[url.pathname] = routeCount;
        if (!limits.has(ip) && limits.size >= 5000) limits.delete(limits.keys().next().value);
        limits.set(ip, limit);
        if (limit.count > 180 || routeCount > (url.pathname === '/api/client-events' ? 10 : req.method === 'GET' ? 120 : 60)) throw new HttpError(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
        if (['/api/catalog', '/api/recommend'].includes(url.pathname)) {
          if (requireSharedRate && !guard?.rateLimit) throw new HttpError(503, '검색 보호 서비스를 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
          if (guard?.rateLimit) { try { await guard.rateLimit(ip, url.pathname); } catch (error) { if (error.status === 429) throw error; logEvent('shared_store_failed', { requestId, error }); throw new HttpError(503, '검색 보호 서비스를 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); } }
        }
        if (req.method === 'GET' && url.pathname === '/api/status') {
          const session = await guard?.session(req.headers.cookie);
          if (session && !session.existing) res.setHeader('Set-Cookie', `onhye_session=${session.cookie}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=86400${publicOrigin ? '; Secure' : ''}`);
          return send(200, { geminiConfigured: ready, geminiAvailable: available, csrfToken: session?.csrfToken, botRequired, botProvider: botCheck ? 'vercel' : 'turnstile', turnstileSiteKey: available && botRequired ? process.env.TURNSTILE_SITE_KEY : null, dataMode: catalog.mode, checkedAt: catalog.checkedAt, count: catalog.items.length });
        }
        if (req.method === 'GET' && url.pathname === '/api/catalog') {
          const parsed = CatalogQuery.safeParse(Object.fromEntries(url.searchParams));
          if (!parsed.success) {
            logEvent('validation_failed', { requestId, route: url.pathname, issues: parsed.error.issues, rewriteParameterPresent: url.searchParams.has('path'), unexpectedQueryCount: [...url.searchParams.keys()].filter(key => !['q', 'topic', 'region', 'agency', 'page'].includes(key)).length });
            throw new HttpError(400, '검색어·필터·페이지를 확인하세요.');
          }
          return send(200, { ...catalogMetadata, ...cataloguePage(sortedItems, parsed.data) });
        }
        if (req.method === 'GET' && url.pathname === '/api/catalog-meta') return send(200, catalogMetadata);
        if (req.method === 'GET' && url.pathname === '/api/benefit') {
          const item = byId.get(url.searchParams.get('id'));
          if (!item) throw new HttpError(404, '해당 제도를 찾지 못했습니다.');
          return send(200, item);
        }
        const body = await readJson(req);
        if (url.pathname === '/api/client-events') {
          if (!req.headers.origin || !origins.includes(req.headers.origin)) throw new HttpError(403, '동일 출처에서만 기록할 수 있습니다.');
          const parsed = ClientEvent.safeParse(body);
          if (!parsed.success) throw new HttpError(400, '오류 기록 형식을 확인하세요.');
          logEvent('client_error', { requestId: parsed.data.requestId || requestId, route: parsed.data.route, clientEvent: parsed.data.event, clientLocation: parsed.data });
          return send(202, { recorded: true });
        }
        if (url.pathname === '/api/analyze') {
          const parsed = AnalyzeInput.safeParse(body);
          if (!parsed.success) { logEvent('validation_failed', { requestId, route: url.pathname, issues: parsed.error.issues }); throw new HttpError(400, '상황을 2~2,000자로 입력하고 모드를 확인해 주세요.'); }
          const input = parsed.data;
          if (input.mode !== 'gemini' || localGuidance(input.text)) return send(200, await analyze(input, { ...aiConfig, requestId }));
          if (!available) throw new HttpError(503, '현재 AI 상담을 사용할 수 없어요. 직접 분야를 선택해 주세요.');
          if (!input.consent) throw new HttpError(400, '상황 설명을 AI에 보내는 데 동의가 필요합니다.');
          if (!req.headers.origin || !origins.includes(req.headers.origin)) throw new HttpError(403, '상담 화면에서 다시 요청해 주세요.');
          const session = await guard.session(req.headers.cookie);
          await guard.verify(session, req.headers['x-csrf-token']);
          const id = req.headers['x-request-id'];
          if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new HttpError(400, '요청 식별자가 필요합니다. 화면에서 다시 시도해 주세요.');
          if (botRequired) {
            if (botCheck) await botCheck(req);
            else await verifyBot(input.turnstileToken, { secret: process.env.TURNSTILE_SECRET_KEY, hostname: new URL(publicOrigin).hostname });
          }
          const ticket = await guard.admit(session.actor, clientIp(req), id, redactMoney(input.text));
          let result;
          try { result = await analyze(input, { ...aiConfig, requestId }); }
          finally { try { await guard.finish(ticket); } catch (error) { logEvent('shared_store_failed', { requestId, error }); } }
          return send(200, result);
        }
        const parsed = RecommendInput.safeParse(body);
        if (!parsed.success) { logEvent('validation_failed', { requestId, route: url.pathname, issues: parsed.error.issues }); throw new HttpError(400, '관심 분야와 추가 입력을 확인해 주세요. 나이는 0~120 사이의 정수입니다.'); }
        const asOf = koreanDate();
        const { page, ...criteria } = parsed.data;
        const cacheKey = createHash('sha256').update(JSON.stringify([asOf, criteria])).digest('hex');
        let cached = recommendationCache.get(cacheKey);
        if (!cached || cached.expires <= now()) {
          const candidates = recommend(catalog.items.filter(item => parsed.data.includeClosed || !isClosed(item, asOf)), parsed.data.resultTopic ? [parsed.data.resultTopic] : parsed.data.topics, parsed.data.profile, parsed.data.preferredTopics);
          const groups = Object.fromEntries(['matched', 'unknown', 'outside'].map(group => [group, candidates.filter(item => item.group === group).length]));
          const shortlist = shortlistRecommendations(candidates, parsed.data.resultTopic ? [parsed.data.resultTopic] : parsed.data.topics, parsed.data.profile, parsed.data.preferredTopics);
          cached = { candidates, groups, shortlist, expires: now() + 30000 };
          for (const [key, value] of recommendationCache) if (value.expires <= now()) recommendationCache.delete(key);
          if (recommendationCache.size >= 2) recommendationCache.delete(recommendationCache.keys().next().value);
          recommendationCache.set(cacheKey, cached);
        }
        const { candidates, groups, shortlist } = cached;
        return send(200, { shortlist, groups, items: candidates.slice((parsed.data.page - 1) * 30, parsed.data.page * 30), page: parsed.data.page, pages: Math.ceil(candidates.length / 30), total: candidates.length, checkedAt: catalog.checkedAt, dataMode: catalog.mode });
      } catch (error) {
        logEvent('request_exception', { requestId, route: url.pathname, status: error.status || 500, error });
        if (error.status === 429) res.setHeader('Retry-After', String(error.retryAfter || 60));
        return send(error.status || 500, { error: error.status ? error.message : '요청을 처리하지 못했습니다. 다시 시도해 주세요.' });
      }
    }
    if (vite) {
      try {
        const pathname = decodeURIComponent(url.pathname).replaceAll('\\', '/');
        const filename = pathname.startsWith('/@fs/') ? path.resolve('/' + pathname.slice(5)) : path.resolve('.' + pathname);
        const actual = await realpath(filename).catch(() => filename);
        const privateFile = value => /(?:^|[\/])(?:\.private|\.git)(?:[\/]|$)|(?:^|[\/])\.env[^\/]*$|\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/i.test(value);
        const guardPath = await realpath(path.resolve(guardFile)).catch(() => path.resolve(guardFile));
        if (privateFile(pathname) || privateFile(actual) || [guardPath, ...['-wal', '-shm', '-journal'].map(suffix => guardPath + suffix)].includes(actual)) { res.writeHead(403); return res.end(); }
      } catch { res.writeHead(400); return res.end(); }
      return vite.middlewares(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    try {
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      let filename = path.resolve('dist', relative || 'index.html');
      if (!filename.startsWith(path.resolve('dist') + path.sep)) { res.writeHead(403); return res.end(); }
      let content;
      try { content = await readFile(filename); }
      catch {
        if (path.extname(filename)) { res.writeHead(404); return res.end('Not found'); }
        filename = path.resolve('dist/index.html'); content = await readFile(filename);
      }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.on('close', () => guard?.close());
  return { server, vite, handler: server.listeners('request')[0] };
}

export async function startServer(options = {}) {
  const app = await createApplication(options);
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(options.port ?? Number(process.env.PORT || 5173), options.host || process.env.HOST || '127.0.0.1', resolve); });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = await startServer();
  console.log(`온혜: http://${process.env.HOST || '127.0.0.1'}:${server.address().port}`);
}
