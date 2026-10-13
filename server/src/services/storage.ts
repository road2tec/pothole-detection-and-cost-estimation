import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import type { Response } from 'express';
import { env } from '../config/env.js';
import { badRequest, notFound } from '../utils/errors.js';

export const IMAGE_MIME = new Set(['image/jpeg', 'image/png']);
export const VIDEO_MIME = new Set(['video/mp4']);
export const GPX_MIME = new Set(['application/gpx+xml', 'application/xml', 'text/xml', 'application/octet-stream']);

/** Resolve a storage-relative path and refuse anything outside STORAGE_DIR. */
export function storagePath(relative: string): string {
  if (!relative || relative.includes('\0') || path.isAbsolute(relative)) throw badRequest('Invalid file path');
  const root = env.STORAGE_DIR;
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw badRequest('Invalid file path');
  return resolved;
}

export function toRelative(absolute: string): string {
  return path.relative(env.STORAGE_DIR, absolute).split(path.sep).join('/');
}

export async function ensureStorage(): Promise<void> {
  for (const dir of ['uploads', 'results', 'reports', 'exports', 'tmp']) {
    await fsp.mkdir(path.join(env.STORAGE_DIR, dir), { recursive: true });
  }
}

/** Check magic bytes: never trust the client-supplied MIME type alone. */
export async function sniffType(file: string): Promise<'jpeg' | 'png' | 'mp4' | 'xml' | null> {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
    const head = buf.toString('utf8').trimStart();
    if (head.startsWith('<?xml') || head.startsWith('<gpx')) return 'xml';
    return null;
  } finally {
    await fh.close();
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

/** Multer writes to storage/tmp with a random name; files are validated and moved afterwards. */
export function uploadMiddleware(maxBytes: number, maxFiles: number) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, path.join(env.STORAGE_DIR, 'tmp')),
      filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
    }),
    limits: { fileSize: maxBytes, files: maxFiles + 1, fields: 30, fieldSize: 64 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok =
        (file.fieldname === 'files' && (IMAGE_MIME.has(file.mimetype) || VIDEO_MIME.has(file.mimetype))) ||
        (file.fieldname === 'gpx' && (GPX_MIME.has(file.mimetype) || file.originalname.toLowerCase().endsWith('.gpx')));
      if (!ok) return cb(badRequest(`Unsupported file type: ${file.mimetype}`));
      cb(null, true);
    },
  });
}

export async function moveInto(tmpFile: string, relDir: string, ext: string): Promise<string> {
  const dir = storagePath(relDir);
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${crypto.randomUUID()}.${ext}`);
  await fsp.rename(tmpFile, target);
  return toRelative(target);
}

export async function removeQuietly(file: string | undefined): Promise<void> {
  if (!file) return;
  await fsp.rm(file, { force: true }).catch(() => undefined);
}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
};

/** Stream an authorised file. Callers must have checked permissions first. */
export async function sendStoredFile(res: Response, relative: string | undefined | null, downloadName?: string) {
  if (!relative) throw notFound('File');
  const abs = storagePath(relative);
  const stat = await fsp.stat(abs).catch(() => null);
  if (!stat?.isFile()) throw notFound('File');
  const type = CONTENT_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (downloadName) {
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName.replace(/[^\w.-]/g, '_')}"`);
  }
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(abs).on('error', reject).on('end', resolve).pipe(res);
  });
}
