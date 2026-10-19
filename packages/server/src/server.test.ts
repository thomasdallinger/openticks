import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newTrackingId, pixelUrl, tickState, type LiveEvent } from '@openticks/core';
import type { Config } from './config.ts';
import { startServer } from './server.ts';

const KEY = 'test-key';
const dataDir = mkdtempSync(join(tmpdir(), 'openticks-'));
const config: Config = {
  port: 0,
  dataDir,
  accessKey: KEY,
  settleMs: 50,
  selfViewWindowMs: 1000,
  minOpenDelayMs: 0,
  retentionDays: 30,
};

let running: ReturnType<typeof startServer>;
let base: string;

beforeAll(() => {
  running = startServer(config, { resolveMailHost: async () => 'other', settleIntervalMs: 20 });
  base = running.url.href.replace(/\/$/, '');
});

afterAll(async () => {
  await running.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

function api(path: string, init: RequestInit = {}) {
  return fetch(`${base}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...init.headers },
  });
}

/** Collects live events and lets a test wait for one that matches. */
function connectLive(account: string) {
  const events: LiveEvent[] = [];
  const waiters: { match: (e: LiveEvent) => boolean; resolve: (e: LiveEvent) => void }[] = [];
  const ws = new WebSocket(`${base.replace('http', 'ws')}/api/live?key=${KEY}&account=${account}`);
  ws.onmessage = (msg) => {
    const event = JSON.parse(String(msg.data)) as LiveEvent;
    events.push(event);
    for (const w of [...waiters]) {
      if (w.match(event)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(event);
      }
    }
  };
  const next = (match: (e: LiveEvent) => boolean) =>
    new Promise<LiveEvent>((resolve, reject) => {
      const found = events.find(match);
      if (found) return resolve(found);
      waiters.push({ match, resolve });
      setTimeout(() => reject(new Error('timed out waiting for live event')), 2000);
    });
  return { ws, next };
}

test('pixel always answers with an uncacheable gif', async () => {
  const res = await fetch(pixelUrl(base, newTrackingId()));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/gif');
  expect(res.headers.get('cache-control')).toContain('no-store');
  expect((await res.arrayBuffer()).byteLength).toBe(42);
});

test('api and live endpoint require the access key', async () => {
  expect((await fetch(`${base}/api/info`)).status).toBe(401);
  expect((await fetch(`${base}/api/info`, { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
  expect((await fetch(`${base}/api/live?key=nope&account=a@b.c`)).status).toBe(401);
  expect(await (await api('/info')).json()).toEqual({ name: 'openticks', version: '0.1.0' });
});

test('invalid input is rejected with 400', async () => {
  const res = await api('/messages', { method: 'POST', body: JSON.stringify({ id: 'short' }) });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBeString();
});

test('sent → opened is pushed live to the sender', async () => {
  const live = connectLive('me@example.com');
  await live.next((e) => e.type === 'snapshot');

  const id = newTrackingId();
  const created = await api('/messages', {
    method: 'POST',
    body: JSON.stringify({
      id,
      provider: 'gmail',
      account: 'me@example.com',
      subject: 'Quarterly numbers',
      recipients: [{ email: 'anna@acme.io', name: 'Anna', field: 'to' }],
    }),
  });
  expect(created.status).toBe(201);

  await api(`/messages/${id}/sent`, {
    method: 'POST',
    body: JSON.stringify({ providerMessageId: '18c0ffee', providerThreadId: '18c0ffee' }),
  });
  const sentEvent = await live.next((e) => e.type === 'message' && e.message.sentAt !== null);
  if (sentEvent.type !== 'message') throw new Error('unreachable');
  expect(tickState(sentEvent.message)).toBe('sent');

  await fetch(pixelUrl(base, id), { headers: { 'User-Agent': 'Thunderbird' } });
  const readEvent = await live.next((e) => e.type === 'message' && e.message.opens.count > 0);
  if (readEvent.type !== 'message') throw new Error('unreachable');
  expect(tickState(readEvent.message)).toBe('read');
  expect(readEvent.message.recipients[0]).toMatchObject({ email: 'anna@acme.io', name: 'Anna', readVia: 'open' });

  const listed = (await (await api('/messages?account=me@example.com')).json()) as { id: string }[];
  expect(listed.map((m) => m.id)).toContain(id);
  live.ws.close();
});

test("account-scoped sockets don't receive other accounts' messages", async () => {
  const live = connectLive('someone-else@example.com');
  const snapshot = await live.next((e) => e.type === 'snapshot');
  expect(snapshot.type === 'snapshot' && snapshot.messages).toEqual([]);
  live.ws.close();
});

test('a socket without account receives every account', async () => {
  const live = connectLive('');
  const snapshot = await live.next((e) => e.type === 'snapshot');
  expect(snapshot.type === 'snapshot' && snapshot.messages.length).toBeGreaterThan(0);
  live.ws.close();
});
