import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { isTrackingId, PIXEL_PATH, type LiveEvent, type ServerInfo } from '@openticks/core';
import type { TrackingStore } from './store.ts';
import {
  parseMarkSent,
  parseRegister,
  parseReply,
  parseSelfViews,
  trackingId,
  ValidationError,
} from './validate.ts';

/** Smallest valid transparent 1×1 GIF. */
const PIXEL_GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0),
);

export interface AppDeps {
  store: TrackingStore;
  accessKey: string;
  version: string;
  publish: (account: string, event: LiveEvent) => void;
  now?: () => number;
}

export function isAuthorized(provided: string | null | undefined, accessKey: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(accessKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp({ store, accessKey, version, publish, now = Date.now }: AppDeps) {
  const app = new Hono();
  const info: ServerInfo = { name: 'openticks', version };

  const pushMessage = (id: string) => {
    const message = store.get(id);
    if (message) publish(message.account, { type: 'message', message });
    return message;
  };

  app.get('/', (c) => c.json(info));
  app.get('/healthz', (c) => c.text('ok'));

  app.get(`${PIXEL_PATH}:file`, (c) => {
    const id = c.req.param('file').replace(/\.gif$/, '');
    if (isTrackingId(id)) store.recordOpen(id, c.req.header('user-agent') ?? null, now());
    return c.body(PIXEL_GIF, 200, {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    });
  });

  const api = new Hono();
  api.use(cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], maxAge: 86400 }));
  api.use(bodyLimit({ maxSize: 256 * 1024 }));
  api.use(async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const header = c.req.header('authorization');
    const key = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!isAuthorized(key, accessKey)) return c.json({ error: 'invalid access key' }, 401);
    await next();
  });
  api.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'invalid JSON' }, 400);
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });

  api.get('/info', (c) => c.json(info));

  api.get('/messages', (c) => {
    const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 500);
    return c.json(store.list({ account: c.req.query('account'), limit }));
  });

  api.post('/messages', async (c) => {
    const input = parseRegister(await c.req.json());
    const message = store.register(input, now());
    publish(message.account, { type: 'message', message });
    return c.json(message, 201);
  });

  api.get('/messages/:id', (c) => {
    const message = store.get(trackingId(c.req.param('id')));
    return message ? c.json(message) : c.json({ error: 'not found' }, 404);
  });

  api.post('/messages/:id/sent', async (c) => {
    const id = trackingId(c.req.param('id'));
    if (!store.markSent(id, parseMarkSent(await c.req.json()), now())) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(pushMessage(id));
  });

  api.post('/messages/:id/replies', async (c) => {
    const id = trackingId(c.req.param('id'));
    const reply = parseReply(await c.req.json());
    if (store.recordReply(id, reply.email, reply.at ?? now())) pushMessage(id);
    return c.body(null, 204);
  });

  api.post('/self-views', async (c) => {
    store.recordSelfViews(parseSelfViews(await c.req.json()).ids, now());
    return c.body(null, 204);
  });

  app.route('/api', api);
  return app;
}
