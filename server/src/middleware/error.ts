import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import { MeasurementError } from '../services/costing.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Validation failed', details } });
  }
  if (err instanceof MeasurementError) {
    return res.status(422).json({ error: { code: 'INVALID_MEASUREMENT', message: err.message } });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the size limit' : err.message;
    return res.status(413).json({ error: { code: err.code, message } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: `Invalid ${err.path}` } });
  }
  if ((err as { code?: number }).code === 11000) {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with these values already exists' } });
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred' } });
}
