import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function pageMeta(p: Pagination, total: number) {
  return { page: p.page, limit: p.limit, total, pages: Math.max(1, Math.ceil(total / p.limit)) };
}

/** Escape user text before it is used inside a MongoDB $regex. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
