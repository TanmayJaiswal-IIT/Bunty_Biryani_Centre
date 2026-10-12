import type { Express } from 'express';
import request from 'supertest';
import { APP_ORIGIN } from './app';
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './factories';

/** Logs in and returns the `bbc_admin=…` cookie pair to send back as the Cookie header. */
export async function loginCookie(
  app: Express,
  username: string = ADMIN_USERNAME,
  password: string = ADMIN_PASSWORD,
): Promise<string> {
  const res = await request(app)
    .post('/api/admin/login')
    .set('Origin', APP_ORIGIN)
    .send({ username, password });
  if (res.status !== 200) throw new Error(`login failed in test helper: ${res.status} ${res.text}`);
  const header = res.headers['set-cookie'];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error('login did not set a cookie');
  return cookie.split(';')[0] as string;
}

export interface AdminClient {
  /** Cookie only: reads need no Origin. */
  get(path: string): request.Test;
  /** Cookie + the app's Origin, as the admin browser sends on writes. */
  send(method: 'post' | 'patch' | 'put' | 'delete', path: string, body?: unknown): request.Test;
}

/** Logs in as the factory admin (`createAdmin()` must have run) and returns a client that sends the session cookie. */
export async function adminClient(app: Express): Promise<AdminClient> {
  const cookie = await loginCookie(app);
  return {
    get: (path) => request(app).get(path).set('Cookie', cookie),
    send: (method, path, body) => {
      const req = request(app)[method](path).set('Cookie', cookie).set('Origin', APP_ORIGIN);
      return body === undefined ? req : req.send(body as object);
    },
  };
}
