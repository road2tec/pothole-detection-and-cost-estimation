import type { Request } from 'express';
import { AuditLog, Notification } from '../models/Misc.js';
import { logger } from '../config/logger.js';

export async function audit(
  req: Request | null,
  action: string,
  entity: string,
  entityId?: unknown,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await AuditLog.create({
      user: req?.user?.id,
      userEmail: req?.user?.email,
      action,
      entity,
      entityId: entityId === undefined ? undefined : String(entityId),
      details,
      ip: req?.ip,
    });
  } catch (err) {
    // Auditing must never break the primary action, but failures are logged loudly.
    logger.error({ err, action, entity }, 'Failed to write audit log');
  }
}

export async function notify(
  userId: unknown,
  type: string,
  title: string,
  message?: string,
  link?: string,
): Promise<void> {
  try {
    await Notification.create({ user: userId as any, type, title, message, link });
  } catch (err) {
    logger.error({ err, type }, 'Failed to create notification');
  }
}
