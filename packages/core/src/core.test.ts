import { describe, expect, test } from 'bun:test';
import {
  findPixelIds,
  isTrackingId,
  newTrackingId,
  pixelHtml,
  statusLine,
  stripPixels,
  tickState,
  type RecipientStatus,
  type TrackedMessage,
} from './index.ts';

const SERVER = 'https://ticks.example.com/';

function recipient(email: string, readAt: number | null = null): RecipientStatus {
  return { email, field: 'to', readAt, readVia: readAt ? 'open' : null };
}

function message(overrides: Partial<TrackedMessage> = {}): TrackedMessage {
  return {
    id: newTrackingId(),
    provider: 'gmail',
    account: 'me@example.com',
    subject: 'Hello',
    providerMessageId: null,
    providerThreadId: null,
    createdAt: 1,
    sentAt: 2,
    recipients: [recipient('a@example.com')],
    opens: { count: 0, unattributed: 0, firstAt: null, lastAt: null },
    ...overrides,
  };
}

describe('tickState', () => {
  test('pending until sent', () => {
    expect(tickState(message({ sentAt: null }))).toBe('pending');
  });

  test('an open proves it was sent even without a sent confirmation', () => {
    const m = message({
      sentAt: null,
      recipients: [recipient('a@example.com', 5)],
      opens: { count: 1, unattributed: 0, firstAt: 5, lastAt: 5 },
    });
    expect(tickState(m)).toBe('read');
  });

  test('single recipient: sent → read', () => {
    expect(tickState(message())).toBe('sent');
    expect(tickState(message({ recipients: [recipient('a@example.com', 3)] }))).toBe('read');
  });

  test('multiple recipients: partial until everyone read', () => {
    const recipients = [recipient('a@example.com', 3), recipient('b@example.com')];
    const m = message({ recipients });
    expect(tickState(m)).toBe('partial');
    expect(statusLine(m)).toBe('Read by 1 of 2');
    expect(tickState(message({ recipients: [recipient('a@x.io', 3), recipient('b@x.io', 4)] }))).toBe(
      'read',
    );
  });

  test('unattributed opens are partial with an explanation', () => {
    const m = message({
      recipients: [recipient('a@example.com'), recipient('b@example.com')],
      opens: { count: 2, unattributed: 2, firstAt: 3, lastAt: 4 },
    });
    expect(tickState(m)).toBe('partial');
    expect(statusLine(m)).toBe('Opened 2× by someone');
  });
});

describe('pixel helpers', () => {
  test('ids are 22 url-safe chars and unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, newTrackingId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(isTrackingId(id)).toBe(true);
  });

  test('finds ids in direct and Gmail-proxied urls, ignores other hosts', () => {
    const id = newTrackingId();
    const other = newTrackingId();
    const urls = [
      `https://ticks.example.com/o/${id}.gif`,
      `https://ci3.googleusercontent.com/meips/ADKq_Nab=s0-d-e1-ft#https://ticks.example.com/o/${id}.gif`,
      `https://evil.example.org/o/${other}.gif`,
      'https://example.com/logo.png',
    ];
    expect(findPixelIds(urls, SERVER)).toEqual([id]);
  });

  test('stripPixels removes our pixels and keeps everything else', () => {
    const id = newTrackingId();
    const html = `<p>Hi</p>${pixelHtml(SERVER, id)}<img src="https://example.com/a.png"><blockquote><img src="https://ci3.googleusercontent.com/x#https://ticks.example.com/o/${newTrackingId()}.gif" width="1"></blockquote>`;
    expect(stripPixels(html, SERVER)).toBe(
      '<p>Hi</p><img src="https://example.com/a.png"><blockquote></blockquote>',
    );
  });
});
