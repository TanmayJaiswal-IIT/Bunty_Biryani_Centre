import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import {
  LOGIN_RATE_LIMIT,
  LOOKUP_RATE_LIMIT,
  ORDER_RATE_LIMIT,
  type RateLimitRule,
} from '../shared/limits.js';
import { loginSchema } from '../shared/schemas/auth.js';
import { createOrderSchema, lookupSchema } from '../shared/schemas/order.js';
import type { Clock } from '../shared/time.js';
import type { Config } from './config.js';
import type { PrismaClient } from './db.js';
import { AppError } from './lib/app-error.js';
import { createLogger, type Logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { originCheck } from './middleware/origin-check.js';
import { createLimiter } from './middleware/rate-limits.js';
import { requestLog } from './middleware/request-log.js';
import { requireAdmin } from './middleware/require-admin.js';
import { validate } from './middleware/validate.js';
import { adminAuthHandlers } from './routes/admin/auth.js';
import { mountAdminRoutes } from './routes/admin/index.js';
import { deliveryOptionsHandler } from './routes/delivery.js';
import { healthHandler } from './routes/health.js';
import { menuHandler } from './routes/menu.js';
import { orderHandlers } from './routes/orders.js';
import { mountClient } from './static.js';

export interface AppLimits {
  login: RateLimitRule;
  order: RateLimitRule;
  lookup: RateLimitRule;
}

export interface AppDeps {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  logger?: Logger;
  /** Lowered by tests. */
  limits?: Partial<AppLimits>;
  /**
   * Folder with the built client. Undefined → `dist/client`; null → don't serve the client
   * (pnpm dev, where Vite does). Nothing is mounted if the folder has no index.html.
   */
  clientDir?: string | null;
}

// Batch 1 §9.5. style-src 'self' means components must not use inline style attributes.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  imgSrc: ["'self'", 'https:', 'data:'],
  styleSrc: ["'self'"],
  scriptSrc: ["'self'"],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

export function createApp({
  prisma,
  clock,
  config,
  logger = createLogger(),
  limits = {},
  clientDir,
}: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestLog(logger));
  app.use(
    helmet({
      // The Vite dev server serves the client in development, so CSP applies everywhere else
      // (which also lets the e2e run catch violations).
      contentSecurityPolicy: config.isDevelopment
        ? false
        : { useDefaults: false, directives: CSP_DIRECTIVES },
      strictTransportSecurity: config.isProduction,
    }),
  );

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '10kb' }));
  api.get('/health', healthHandler(prisma));
  api.get('/menu', menuHandler(prisma, clock));
  api.get('/delivery-options', deliveryOptionsHandler(prisma, clock));

  const orders = orderHandlers({ prisma, clock, logger });
  // Counts every attempt (Batch 1 §6.11): generous, because a hostel shares one Wi-Fi IP.
  const orderLimiter = createLimiter(limits.order ?? ORDER_RATE_LIMIT);
  api.post('/orders', orderLimiter, validate({ body: createOrderSchema }), orders.create);
  // Counts failed lookups only (Batch 5 §6): guesses at sequential order numbers fail and use the
  // allowance up, while the confirmation page's refresh never does.
  const lookupLimiter = createLimiter(limits.lookup ?? LOOKUP_RATE_LIMIT, { failedOnly: true });
  api.post('/orders/lookup', lookupLimiter, validate({ body: lookupSchema }), orders.lookup);

  const auth = adminAuthHandlers({
    prisma,
    clock,
    jwtSecret: config.jwtSecret,
    isProduction: config.isProduction,
  });
  const checkOrigin = originCheck(config.allowedOrigins);
  const loginLimiter = createLimiter(limits.login ?? LOGIN_RATE_LIMIT, { failedOnly: true });

  const admin = express.Router();
  admin.use(cookieParser());
  admin.post(
    '/login',
    checkOrigin,
    loginLimiter,
    validate({ body: loginSchema }),
    auth.loginHandler,
  );
  // Everything below needs a session; an unauthenticated request is 401 before the Origin check.
  admin.use(
    requireAdmin({
      prisma,
      clock,
      jwtSecret: config.jwtSecret,
      isProduction: config.isProduction,
    }),
    checkOrigin,
  );
  admin.post('/logout', auth.logoutHandler);
  admin.get('/me', auth.meHandler);
  mountAdminRoutes(admin, { prisma, clock });
  api.use('/admin', admin);

  api.use((_req, _res, next) => next(new AppError('NOT_FOUND', 'Not found.')));
  app.use('/api', api);

  if (clientDir !== null) mountClient(app, clientDir ?? path.resolve('dist/client'));

  app.use(errorHandler(logger));
  return app;
}
