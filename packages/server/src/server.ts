import { join } from 'node:path';
import type { LiveEvent } from '@openticks/core';
import { createApp, isAuthorized } from './app.ts';
import type { Config } from './config.ts';
import { createMailHostResolver, type MailHostResolver } from './mail-hosts.ts';
import { TrackingStore } from './store.ts';
import pkg from '../package.json' with { type: 'json' };

interface LiveSocketData {
  /** Only this account's messages, or every account on the server when null. */
  account: string | null;
}

const SNAPSHOT_LIMIT = 300;
const HOUR = 60 * 60 * 1000;

const ALL_TOPIC = 'all';
const topic = (account: string | null) => (account ? `account:${account.toLowerCase()}` : ALL_TOPIC);

export interface StartOptions {
  dbPath?: string;
  resolveMailHost?: MailHostResolver;
  settleIntervalMs?: number;
}

/** Starts the HTTP + WebSocket server. `/api/live` is handled here because it needs Bun's upgrade. */
export function startServer(config: Config, options: StartOptions = {}) {
  const store = new TrackingStore(options.dbPath ?? join(config.dataDir, 'openticks.db'), {
    settleMs: config.settleMs,
    selfViewWindowMs: config.selfViewWindowMs,
    minOpenDelayMs: config.minOpenDelayMs,
    resolveMailHost: options.resolveMailHost ?? createMailHostResolver(),
  });

  let publish = (_account: string, _event: LiveEvent) => {};
  const app = createApp({
    store,
    accessKey: config.accessKey,
    version: pkg.version,
    publish: (account, event) => publish(account, event),
  });

  const server = Bun.serve({
    port: config.port,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/api/live') {
        if (!isAuthorized(url.searchParams.get('key'), config.accessKey)) {
          return new Response('invalid access key', { status: 401 });
        }
        const account = url.searchParams.get('account')?.trim().toLowerCase() || null;
        if (server.upgrade(req, { data: { account } })) return;
        return new Response('expected a WebSocket upgrade', { status: 426 });
      }
      return app.fetch(req);
    },
    websocket: {
      data: {} as LiveSocketData,
      idleTimeout: 120,
      open(ws) {
        ws.subscribe(topic(ws.data.account));
        const event: LiveEvent = {
          type: 'snapshot',
          messages: store.list({ account: ws.data.account ?? undefined, limit: SNAPSHOT_LIMIT }),
        };
        ws.send(JSON.stringify(event));
      },
      message(ws, message) {
        if (message === 'ping') ws.send('pong');
      },
    },
  });

  publish = (account, event) => {
    const payload = JSON.stringify(event);
    server.publish(topic(account), payload);
    server.publish(ALL_TOPIC, payload);
  };

  const settleTimer = setInterval(() => {
    for (const id of store.settle(Date.now())) {
      const message = store.get(id);
      if (message) publish(message.account, { type: 'message', message });
    }
  }, options.settleIntervalMs ?? 1000);

  const purgeTimer = setInterval(() => {
    store.purge(Date.now() - config.retentionDays * 24 * HOUR);
  }, HOUR);

  return {
    server,
    store,
    url: server.url,
    async stop() {
      clearInterval(settleTimer);
      clearInterval(purgeTimer);
      await server.stop(true);
      store.close();
    },
  };
}
