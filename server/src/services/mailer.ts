import nodemailer from 'nodemailer';
import { env, smtpConfigured } from '../config/env.js';
import { logger } from '../config/logger.js';

const transport = smtpConfigured
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: (env.SMTP_PORT ?? 587) === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export type MailResult = 'sent' | 'not_configured' | 'failed';

/**
 * Send an email if SMTP is configured. When it is not, nothing is sent and the caller is told,
 * so the UI can show an honest message instead of claiming an email went out.
 */
export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  if (!transport) {
    if (env.NODE_ENV === 'development') {
      // Development convenience only: the message (which may contain a reset link) goes to the
      // local server log. This branch never runs in production.
      logger.warn({ to, subject, text }, 'SMTP not configured — email written to development log only');
    }
    return 'not_configured';
  }
  try {
    await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
    return 'sent';
  } catch (err) {
    logger.error({ err, to, subject }, 'Email delivery failed');
    return 'failed';
  }
}
