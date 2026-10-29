import { createHash } from 'node:crypto';
import guides from './program-guides.json' with { type: 'json' };
const byId = new Map(guides.map(guide => [guide.id, guide]));
export function programGuide(item) {
  const guide = byId.get(item.id);
  if (!guide || guide.sourceHash !== createHash('sha256').update(JSON.stringify([item.target, item.criteria])).digest('hex')) return null;
  const { sourceHash, ...publicGuide } = guide;
  return publicGuide;
}
