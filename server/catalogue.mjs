import { z } from 'zod';
import { topicKeys } from './domain.mjs';
import { REGIONS } from '../shared/topics.mjs';
export const CatalogQuery = z.object({
  q: z.string().trim().max(100).default(''), topic: z.enum(['all', ...topicKeys]).default('all'),
  region: z.enum(['all', ...REGIONS]).default('all'), agency: z.string().max(80).default('all'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();
export function cataloguePage(items, query) {
  const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = items.filter(item => (query.topic === 'all' || (item.topics || [item.category]).includes(query.topic)) && (query.region === 'all' || item.region === query.region) && (query.agency === 'all' || item.agencyType === query.agency) && terms.every(term => `${item.title} ${item.summary} ${item.agency} ${item.field || ''}`.toLowerCase().includes(term)));
  const pages = Math.max(1, Math.ceil(matches.length / 20)), page = Math.min(query.page, pages);
  return { total: matches.length, page, pages, items: matches.slice((page - 1) * 20, page * 20).map(({ id, title, summary, agency, agencyType, region, category, topics, field, audience, url, sourceTitle, accepting, endDate }) => ({ id, title, summary: summary.slice(0, 400), agency, agencyType, region, category, topics, field, audience, url, sourceTitle, accepting, endDate })) };
}
