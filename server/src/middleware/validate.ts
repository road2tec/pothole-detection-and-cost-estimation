import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from '../utils/errors.js';

type Part = 'body' | 'query' | 'params';

/**
 * Validate and coerce a request part with Zod. Parsed values are placed on req.valid[part]
 * (Express 5 makes req.query read-only, so the original objects are left untouched).
 */
export function validate(schema: ZodType, part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return next(badRequest('Validation failed', issues));
    }
    req.valid = { ...(req.valid ?? {}), [part]: result.data };
    next();
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    valid?: Partial<Record<Part, any>>;
  }
}

export function v<T = any>(req: Request, part: Part = 'body'): T {
  return (req.valid?.[part] ?? {}) as T;
}
