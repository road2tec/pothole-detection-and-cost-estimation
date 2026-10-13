import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { dbReady } from './config/db.js';
import { aiClient } from './integrations/aiClient.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { uploadsRouter } from './routes/uploads.js';
import { potholesRouter } from './routes/potholes.js';
import { calibrationsRouter, cameraProfilesRouter } from './routes/calibrations.js';
import { settingsRouter } from './routes/settings.js';
import { repairVisitsRouter } from './routes/repairVisits.js';
import { analyticsRouter } from './routes/analytics.js';
import { reportsRouter } from './routes/reports.js';
import { integrationsRouter } from './routes/integrations.js';
import { aiRouter, auditRouter, jobsRouter, notificationsRouter, placesRouter } from './routes/misc.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  const origins = env.CLIENT_ORIGIN.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req: { url?: string }) => req.url === '/api/v1/health' } }));
  }
  app.use(
    '/api/',
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === 'test' ? 100_000 : 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    }),
  );

  app.get('/api/v1/health', async (_req, res) => {
    const ai = await aiClient.health().then(
      (h) => ({ reachable: true, model: h.model, depth: h.depth }),
      () => ({ reachable: false, model: 'unknown', depth: 'unknown' }),
    );
    const db = dbReady();
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', database: db ? 'connected' : 'disconnected', ai });
  });

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/users', usersRouter);
  v1.use('/uploads', uploadsRouter);
  v1.use('/potholes', potholesRouter);
  v1.use('/calibrations', calibrationsRouter);
  v1.use('/camera-profiles', cameraProfilesRouter);
  v1.use('/settings', settingsRouter);
  v1.use('/repair-visits', repairVisitsRouter);
  v1.use('/analytics', analyticsRouter);
  v1.use('/reports', reportsRouter);
  v1.use('/integrations', integrationsRouter);
  v1.use('/places', placesRouter);
  v1.use('/ai', aiRouter);
  v1.use('/jobs', jobsRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/audit-logs', auditRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
