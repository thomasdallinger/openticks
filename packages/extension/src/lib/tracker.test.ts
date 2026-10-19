import { describe, expect, test } from 'bun:test';
import { isTrackingId, newTrackingId, type TrackedMessage } from '@openticks/core';
import type { OpenTicksClient } from './client.ts';
import { LiveStore } from './live-store.ts';
import { tooltipText } from './ticks.ts';
import { findReplies, prepareTrackedSend, reportSelfViews } from './tracker.ts';

const SERVER = 'https://ticks.example.com';

function message(overrides: Partial<TrackedMessage> = {}): TrackedMessage {
  return {
    id: newTrackingId(),
    provider: 'gmail',
    account: 'me@example.com',
    subject: 'Hi',
    providerMessageId: 'msg-1',
    providerThreadId: 'thread-1',
    createdAt: 1,
    sentAt: 2,
    recipients: [
      { email: 'anna@acme.io', field: 'to', readAt: null, readVia: null },
      { email: 'ben@acme.io', field: 'cc', readAt: null, readVia: null },
    ],
    opens: { count: 0, unattributed: 0, firstAt: null, lastAt: null },
    ...overrides,
  };
}

function fakeClient(overrides: Partial<OpenTicksClient> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return undefined as never;
    };
  const client = {
    info: record('info'),
    listMessages: record('listMessages'),
    register: record('register'),
    markSent: record('markSent'),
    reportReply: record('reportReply'),
    reportSelfViews: record('reportSelfViews'),
    ...overrides,
  } as OpenTicksClient;
  return { client, calls };
}

describe('prepareTrackedSend', () => {
  const input = {
    serverUrl: SERVER,
    provider: 'gmail',
    account: 'me@example.com',
    subject: 'Hi',
    recipients: [{ email: 'anna@acme.io', field: 'to' as const }],
  };

  test('registers and swaps quoted pixels for a new one', async () => {
    const { client, calls } = fakeClient();
    const quoted = `<img src="${SERVER}/o/${newTrackingId()}.gif">`;
    const result = await prepareTrackedSend(client, { ...input, body: `<p>Hello</p><blockquote>${quoted}</blockquote>` });

    expect(result).not.toBeNull();
    expect(isTrackingId(result!.id)).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'register', args: [{ id: result!.id, subject: 'Hi' }] });
    expect(result!.body).toStartWith('<p>Hello</p><blockquote></blockquote><img src=');
    expect(result!.body).toContain(`${SERVER}/o/${result!.id}.gif`);
  });

  test('sends untracked when the server is down', async () => {
    const { client } = fakeClient({
      register: async () => {
        throw new Error('offline');
      },
    });
    const warn = console.warn;
    console.warn = () => {};
    expect(await prepareTrackedSend(client, { ...input, body: '<p>Hello</p>' })).toBeNull();
    console.warn = warn;
  });
});

test('reportSelfViews finds pixels behind Gmail image proxy urls', () => {
  const { client, calls } = fakeClient();
  const id = newTrackingId();
  const root = {
    querySelectorAll: () => [
      { getAttribute: () => `https://ci3.googleusercontent.com/meips/x=s0-d-e1-ft#${SERVER}/o/${id}.gif` },
      { getAttribute: () => 'https://example.com/logo.png' },
    ],
  } as unknown as ParentNode;
  reportSelfViews(client, root, SERVER);
  expect(calls).toEqual([{ method: 'reportSelfViews', args: [[id]] }]);
});

describe('findReplies', () => {
  test('later messages from recipients count as replies, mine and strangers do not', () => {
    const store = new LiveStore('me@example.com');
    const tracked = message();
    store.apply({ type: 'snapshot', messages: [tracked] });
    const replies = findReplies(
      [
        { providerMessageId: 'older', sender: 'ben@acme.io' },
        { providerMessageId: 'msg-1', sender: 'me@example.com' },
        { providerMessageId: 'r1', sender: 'Anna@acme.io' },
        { providerMessageId: 'r2', sender: 'me@example.com' },
        { providerMessageId: 'r3', sender: 'stranger@acme.io' },
        { providerMessageId: 'r4', sender: 'anna@acme.io' },
      ],
      store,
      'me@example.com',
    );
    expect(replies).toEqual([{ messageId: tracked.id, email: 'anna@acme.io' }]);
  });
});

describe('LiveStore', () => {
  test('keeps only the account, finds latest per thread and notifies', () => {
    const store = new LiveStore('Me@Example.com');
    let notified = 0;
    store.subscribe(() => notified++);
    const older = message({ createdAt: 1 });
    const newer = message({ createdAt: 5, providerMessageId: 'msg-2' });
    store.apply({ type: 'snapshot', messages: [older, message({ account: 'other@example.com' })] });
    store.apply({ type: 'message', message: newer });

    expect(notified).toBe(2);
    expect(store.all().map((m) => m.id)).toEqual([newer.id, older.id]);
    expect(store.latestInThread('thread-1')?.id).toBe(newer.id);
    expect(store.byProviderMessageId('msg-1')?.id).toBe(older.id);
  });
});

test('tooltipText lists every recipient', () => {
  const text = tooltipText(
    message({
      recipients: [
        { email: 'anna@acme.io', name: 'Anna', field: 'to', readAt: Date.now(), readVia: 'reply' },
        { email: 'ben@acme.io', field: 'cc', readAt: null, readVia: null },
      ],
    }),
  );
  expect(text).toStartWith('OpenTicks · Read by 1 of 2\n✓✓ Anna <anna@acme.io> · replied ');
  expect(text).toContain('✓ ben@acme.io · not opened yet');
});
