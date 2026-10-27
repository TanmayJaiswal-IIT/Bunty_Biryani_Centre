import type { NextFunction, Request, Response } from 'express';

/**
 * Redirects GET/HEAD requests on non-canonical hosts to APP_ORIGIN (Batch 8 §5).
 * Only active in production. Preserves path and query parameters with a 301 redirect.
 * /api paths are never redirected so health checks and in-flight API calls continue working.
 */
export function canonicalHost(appOrigin: string, isProduction: boolean) {
  if (!isProduction) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  let targetHostname: string;
  try {
    targetHostname = new URL(appOrigin).hostname.toLowerCase();
  } catch {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    // Only redirect safe read methods
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    // Never redirect /api/* paths (health checks, in-flight orders, etc.)
    const requestPath = req.path || '';
    if (requestPath === '/api' || requestPath.startsWith('/api/')) {
      return next();
    }

    const currentHostname = req.hostname ? req.hostname.toLowerCase() : '';
    if (currentHostname && currentHostname !== targetHostname) {
      const redirectUrl = new URL(req.originalUrl || req.url, appOrigin).toString();
      res.redirect(301, redirectUrl);
      return;
    }

    next();
  };
}
