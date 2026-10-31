import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeApp } from '../helpers/app.js';

describe('Canonical Host redirect (Batch 8 §5)', () => {
  const CANONICAL_ORIGIN = 'https://order.buntybiryani.com';

  it('does nothing in development or test mode (isProduction: false)', async () => {
    const { app } = makeApp({
      config: {
        isProduction: false,
        appOrigin: CANONICAL_ORIGIN,
      },
    });

    const res = await request(app).get('/track').set('Host', 'old-subdomain.onrender.com');
    // Not redirected: proceeds to route handling
    expect(res.status).not.toBe(301);
  });

  it('does not redirect requests on the canonical host in production', async () => {
    const { app } = makeApp({
      config: {
        isProduction: true,
        appOrigin: CANONICAL_ORIGIN,
      },
    });

    const res = await request(app).get('/track').set('Host', 'order.buntybiryani.com');
    expect(res.status).not.toBe(301);
  });

  it('redirects GET requests on non-canonical hosts with 301 to APP_ORIGIN preserving path and query', async () => {
    const { app } = makeApp({
      config: {
        isProduction: true,
        appOrigin: CANONICAL_ORIGIN,
      },
    });

    const res = await request(app)
      .get('/track?id=BB1001&source=whatsapp')
      .set('Host', 'bbc-web.onrender.com');

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(
      'https://order.buntybiryani.com/track?id=BB1001&source=whatsapp',
    );
  });

  it('redirects HEAD requests on non-canonical hosts with 301', async () => {
    const { app } = makeApp({
      config: {
        isProduction: true,
        appOrigin: CANONICAL_ORIGIN,
      },
    });

    const res = await request(app).head('/').set('Host', 'bbc-web.onrender.com');

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://order.buntybiryani.com/');
  });

  it('never redirects /api/health even on a non-canonical host', async () => {
    const { app } = makeApp({
      config: {
        isProduction: true,
        appOrigin: CANONICAL_ORIGIN,
      },
    });

    const res = await request(app).get('/api/health').set('Host', 'bbc-web.onrender.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('never redirects other /api routes or POST requests', async () => {
    const { app } = makeApp({
      config: {
        isProduction: true,
        appOrigin: CANONICAL_ORIGIN,
      },
    });

    const getMenuRes = await request(app).get('/api/menu').set('Host', 'bbc-web.onrender.com');
    expect(getMenuRes.status).toBe(200);

    const postRes = await request(app)
      .post('/api/orders')
      .set('Host', 'bbc-web.onrender.com')
      .send({});
    // POST request is not redirected (returns error or status from api router, not 301)
    expect(postRes.status).not.toBe(301);
  });
});
