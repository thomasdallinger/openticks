import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { newTrackingId, tickState, type Recipient } from '@openticks/core';
import { mailHostFromMx, type MailHost } from './mail-hosts.ts';
import { TrackingStore } from './store.ts';

const GMAIL_PROXY_UA = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)';
const SETTLE = 4000;
const T0 = 1_700_000_000_000;

const hosts: Record<string, MailHost> = { 'gmail.com': 'google', 'acme.io': 'other', 'corp.io': 'google' };

let store: TrackingStore;

beforeEach(() => {
  store = new TrackingStore(':memory:', {
    settleMs: SETTLE,
    selfViewWindowMs: 15_000,
    minOpenDelayMs: 3000,
    resolveMailHost: async (domain) => hosts[domain] ?? 'other',
  });
});

afterEach(() => store.close());

async function sent(recipients: Recipient[]) {
  const id = newTrackingId();
  store.register({ id, provider: 'gmail', account: 'Me@Example.com', subject: 'Hi', recipients }, T0);
  await Bun.sleep(0); // let mail host lookups land
  store.markSent(id, { providerMessageId: 'm1', providerThreadId: 't1' }, T0);
  return id;
}

const to = (email: string): Recipient => ({ email, field: 'to' });

describe('TrackingStore', () => {
  test('single recipient open is counted after the settle delay', async () => {
    const id = await sent([to('anna@acme.io')]);
    expect(store.recordOpen(id, 'Thunderbird', T0 + 60_000)).toBe(true);

    expect(store.settle(T0 + 60_000 + SETTLE - 1)).toEqual([]);
    expect(store.settle(T0 + 60_000 + SETTLE)).toEqual([id]);

    const message = store.get(id)!;
    expect(message.account).toBe('me@example.com');
    expect(message.recipients[0]).toMatchObject({ email: 'anna@acme.io', readAt: T0 + 60_000, readVia: 'open' });
    expect(message.opens).toEqual({ count: 1, unattributed: 0, firstAt: T0 + 60_000, lastAt: T0 + 60_000 });
    expect(tickState(message)).toBe('read');
  });

  test("the sender's own view is not counted", async () => {
    const id = await sent([to('anna@acme.io')]);
    store.recordOpen(id, GMAIL_PROXY_UA, T0 + 60_000);
    store.recordSelfViews([id], T0 + 61_000); // reported just after the proxy fetched the pixel
    expect(store.settle(T0 + 70_000)).toEqual([]);
    expect(tickState(store.get(id)!)).toBe('sent');
  });

  test('opens right after sending are treated as scanners', async () => {
    const id = await sent([to('anna@acme.io')]);
    store.recordOpen(id, 'Microsoft Office', T0 + 500);
    expect(store.settle(T0 + 10_000)).toEqual([]);
    expect(store.get(id)!.opens.count).toBe(0);
  });

  test('unknown ids are ignored', () => {
    expect(store.recordOpen(newTrackingId(), null, T0)).toBe(false);
  });

  test('multiple recipients: Gmail proxy open is attributed to the only Google-hosted recipient', async () => {
    const id = await sent([to('anna@acme.io'), to('ben@gmail.com')]);
    store.recordOpen(id, GMAIL_PROXY_UA, T0 + 60_000);
    store.settle(T0 + 70_000);
    const message = store.get(id)!;
    expect(message.recipients.map((r) => r.readVia)).toEqual([null, 'likely-open']);
    expect(tickState(message)).toBe('partial');
  });

  test('multiple recipients: ambiguous opens stay unattributed', async () => {
    const id = await sent([to('ben@gmail.com'), to('cleo@corp.io')]);
    store.recordOpen(id, GMAIL_PROXY_UA, T0 + 60_000);
    store.recordOpen(id, 'Apple Mail', T0 + 61_000);
    store.settle(T0 + 70_000);
    const message = store.get(id)!;
    expect(message.recipients.every((r) => r.readAt === null)).toBe(true);
    expect(message.opens).toMatchObject({ count: 2, unattributed: 2 });
    expect(tickState(message)).toBe('partial');
  });

  test('a reply marks that recipient as read and upgrades a likely open', async () => {
    const id = await sent([to('anna@acme.io'), to('ben@gmail.com')]);
    store.recordOpen(id, GMAIL_PROXY_UA, T0 + 60_000);
    store.settle(T0 + 70_000);

    expect(store.recordReply(id, 'BEN@gmail.com', T0 + 90_000)).not.toBeNull();
    expect(store.recordReply(id, 'ben@gmail.com', T0 + 95_000)).toBeNull(); // no change
    expect(store.recordReply(id, 'anna@acme.io', T0 + 99_000)).not.toBeNull();

    const message = store.get(id)!;
    expect(message.recipients).toMatchObject([
      { email: 'anna@acme.io', readAt: T0 + 99_000, readVia: 'reply' },
      { email: 'ben@gmail.com', readAt: T0 + 60_000, readVia: 'reply' },
    ]);
    expect(tickState(message)).toBe('read');
  });

  test('purge removes old messages and their opens', async () => {
    const id = await sent([to('anna@acme.io')]);
    store.recordOpen(id, null, T0 + 60_000);
    store.purge(T0 + 1);
    expect(store.get(id)).toBeNull();
    expect(store.db.query('SELECT COUNT(*) AS n FROM opens').get()).toEqual({ n: 0 });
  });
});

test('mailHostFromMx', () => {
  expect(mailHostFromMx(['aspmx.l.google.com.'])).toBe('google');
  expect(mailHostFromMx(['acme-io.mail.protection.outlook.com'])).toBe('microsoft');
  expect(mailHostFromMx(['mx1.acme.io'])).toBe('other');
});
