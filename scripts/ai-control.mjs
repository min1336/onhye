import path from 'node:path';
import { createAiGuard } from '../server/ai-guard.mjs';
import { createFirestoreGuard } from '../server/firestore-guard.mjs';
import { getGoogleClient } from '../server/google-auth.mjs';
const action = process.argv[2];
if (!['pause', 'resume'].includes(action)) { console.error('사용법: node scripts/ai-control.mjs pause|resume'); process.exitCode = 1; }
else {
  const guard = process.env.AI_GUARD_PROVIDER === 'firestore' ? createFirestoreGuard({ project: process.env.GOOGLE_CLOUD_PROJECT, secret: process.env.AI_SESSION_SECRET, client: await getGoogleClient(process.env.GOOGLE_CLOUD_PROJECT) }) : createAiGuard(process.env.AI_GUARD_FILE || path.resolve('.private/ai-guard.sqlite'));
  try { await guard.pause(action === 'pause'); console.log(action === 'pause' ? 'AI 호출 중단: 직접 검색은 유지됩니다.' : 'AI 호출 중단 해제: 기존 호출 한도는 유지됩니다.'); }
  finally { guard.close(); }
}
