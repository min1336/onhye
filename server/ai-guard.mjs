import Database from 'better-sqlite3';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

export class GuardError extends Error {
  constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createAiGuard(file, now = Date.now) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(file);
  chmodSync(file, 0o600);
  db.pragma('busy_timeout = 3000');
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, actor TEXT NOT NULL, ip TEXT NOT NULL, digest TEXT NOT NULL, created INTEGER NOT NULL, pending INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS requests_time ON requests(created);
    CREATE INDEX IF NOT EXISTS requests_actor ON requests(actor, created);`);
  db.prepare('INSERT OR IGNORE INTO settings VALUES (?, ?)').run('secret', randomBytes(32).toString('hex'));
  const secret = db.prepare('SELECT value FROM settings WHERE key = ?').get('secret').value;
  const sessionAuth = createSessionAuth(secret, now);
  const { hash } = sessionAuth;
  const count = (where, ...args) => db.prepare('SELECT COUNT(*) AS n FROM requests WHERE ' + where).get(...args).n;
  const admit = db.transaction((actor, ip, id, text) => {
    const time = now(), minute = time - 60000, day = Math.floor(time / 86400000) * 86400000;
    db.prepare('DELETE FROM requests WHERE created < ?').run(day - 2 * 86400000);
    const key = hash(actor + ':' + id), digest = hash(text);
    if (db.prepare('SELECT id FROM requests WHERE id = ?').get(key)) throw new GuardError(409, '이미 처리했거나 처리 중인 요청입니다.');
    if (db.prepare("SELECT value FROM settings WHERE key = 'paused'").get()?.value === 'true') throw new GuardError(503, 'AI 상담을 잠시 쉬고 있어요. 직접 분야를 선택해 주세요.');
    if (count('created >= ?', day) >= 100 || count('actor = ? AND created >= ?', actor, day) >= 10) throw new GuardError(429, '오늘의 AI 상담 한도에 도달했어요. 직접 분야를 선택해 주세요.', Math.ceil((day + 86400000 - time) / 1000));
    if (count('actor = ? AND created > ?', actor, minute) >= 3 || count('ip = ? AND created > ?', hash(ip), minute) >= 20 || count('pending = 1 AND created > ?', minute) >= 3 || count('actor = ? AND pending = 1 AND created > ?', actor, minute) >= 1) throw new GuardError(429, 'AI 요청이 많아요. 잠시 후 다시 시도하거나 직접 분야를 선택해 주세요.', 60);
    db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?, 1)').run(key, actor, hash(ip), digest, time);
    return key;
  });
  return {
    ...sessionAuth,
    admit: (...args) => admit.immediate(...args),
    finish: id => db.prepare('UPDATE requests SET pending = 0 WHERE id = ?').run(id),
    pause: paused => db.prepare("INSERT OR REPLACE INTO settings VALUES ('paused', ?)").run(String(paused)),
    close: () => db.close(),
  };
}

export async function verifyBot(token, { secret, hostname, fetcher = fetch }) {
  if (!token || !secret) throw new GuardError(403, '봇 방지 확인을 완료해 주세요.');
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret, response: token }), signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    if (!response.ok || result.success !== true || result.hostname !== hostname || result.action !== 'benefit_analyze') throw new Error('Bot verification failed');
  } catch { throw new GuardError(403, '봇 방지 확인에 실패했어요. 다시 확인하거나 직접 분야를 선택해 주세요.'); }
}

export function createSessionAuth(secret, now = Date.now) {
  const hash = value => createHmac('sha256', secret).update(value).digest('hex');
  return { hash,
    session(cookie) {
      const raw = /(?:^|;\s*)onhye_session=([^;]+)/.exec(cookie || '')?.[1];
      const parts = raw?.split('.');
      if (parts?.length === 3 && /^[\da-f-]{36}$/.test(parts[0]) && /^\d{13}$/.test(parts[1]) && Number(parts[1]) > now() && equal(parts[2], hash(parts[0] + '.' + parts[1]))) return { actor: hash(parts[0]), csrfToken: hash('csrf:' + raw), cookie: raw, existing: true };
      const token = randomUUID() + '.' + (now() + 86400000), signed = token + '.' + hash(token);
      return { actor: hash(token.split('.')[0]), csrfToken: hash('csrf:' + signed), cookie: signed, existing: false };
    },
    verify(session, csrf) { if (!session.existing || !equal(session.csrfToken, csrf)) throw new GuardError(403, '상담 연결이 만료됐어요. 화면을 새로고침해 주세요.'); },
  };
}
