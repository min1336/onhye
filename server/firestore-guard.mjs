import { createSessionAuth, GuardError } from './ai-guard.mjs';

export function createFirestoreGuard({ project, secret, client, now = Date.now }) {
  if (!project || !secret || secret.length < 64 || !client) throw new Error('Shared AI guard configuration missing');
  const auth = createSessionAuth(secret, now), { hash } = auth;
  const name = `projects/${project}/databases/(default)/documents/onhye_ai_guard/state`;
  async function mutate(change, documentName = name, expiresAt) {
    const url = 'https://firestore.googleapis.com/v1/' + documentName;
    const signal = AbortSignal.timeout(10000);
    for (let attempt = 0; attempt < 5; attempt++) {
      let document;
      try { document = (await client.request({ url, signal, retry: false })).data; }
      catch (error) { if (error.response?.status !== 404) throw error; }
      const state = document ? JSON.parse(document.fields.data.stringValue) : { paused: false, requests: [] };
      const result = change(state);
      try {
        await client.request({ url: `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`, method: 'POST', signal, retry: false, data: { writes: [{ update: { name: documentName, fields: { data: { stringValue: JSON.stringify(state) }, ...(expiresAt ? { expiresAt: { timestampValue: expiresAt } } : {}) } }, currentDocument: document ? { updateTime: document.updateTime } : { exists: false } }] } });
        return result;
      } catch (error) {
        if (![409, 412].includes(error.response?.status) && error.response?.data?.error?.status !== 'FAILED_PRECONDITION') throw error;
      }
    }
    throw new GuardError(503, 'AI 상담 요청이 겹쳤어요. 잠시 후 다시 시도해 주세요.');
  }
  return { ...auth,
    rateLimit: (ip, route) => {
      const time = now(), window = Math.floor(time / 60000);
      const documentName = `projects/${project}/databases/(default)/documents/onhye_rate_limits/${hash(ip)}`;
      return mutate(state => {
        if (state.window !== window) { state.window = window; state.count = 0; state.routes = {}; delete state.requests; delete state.paused; }
        if (state.count >= 120 || (state.routes[route] || 0) >= 60) throw new GuardError(429, '검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.', Math.ceil((60000 - time % 60000) / 1000));
        state.count++; state.routes[route] = (state.routes[route] || 0) + 1;
      }, documentName, new Date(time + 86400000).toISOString());
    },
    admit: (actor, ip, id, text) => mutate(state => {
      const time = now(), minute = time - 60000, day = Math.floor(time / 86400000) * 86400000;
      state.requests = state.requests.filter(row => row.created >= day - 2 * 86400000);
      const rows = state.requests, key = hash(actor + ':' + id), address = hash(ip);
      if (rows.some(row => row.id === key)) throw new GuardError(409, '이미 처리했거나 처리 중인 요청입니다.');
      if (state.paused) throw new GuardError(503, 'AI 상담을 잠시 쉬고 있어요. 직접 분야를 선택해 주세요.');
      if (rows.filter(row => row.created >= day).length >= 100 || rows.filter(row => row.actor === actor && row.created >= day).length >= 10) throw new GuardError(429, '오늘의 AI 상담 한도에 도달했어요. 직접 분야를 선택해 주세요.', Math.ceil((day + 86400000 - time) / 1000));
      if (rows.filter(row => row.actor === actor && row.created > minute).length >= 3 || rows.filter(row => row.ip === address && row.created > minute).length >= 20 || rows.filter(row => row.pending && row.created > minute).length >= 3 || rows.some(row => row.actor === actor && row.pending && row.created > minute)) throw new GuardError(429, 'AI 요청이 많아요. 잠시 후 다시 시도해 주세요.', 60);
      rows.push({ id: key, actor, ip: address, digest: hash(text), created: time, pending: true });
      return key;
    }),
    finish: id => mutate(state => { const row = state.requests.find(row => row.id === id); if (row) row.pending = false; }),
    pause: paused => mutate(state => { state.paused = paused; }),
    close() {},
  };
}
