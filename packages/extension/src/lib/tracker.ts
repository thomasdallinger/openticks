import {
  findPixelIds,
  newTrackingId,
  pixelHtml,
  stripPixels,
  type ProviderId,
  type Recipient,
} from '@openticks/core';
import type { OpenTicksClient } from './client.ts';
import type { LiveStore } from './live-store.ts';

/**
 * Provider-agnostic tracking logic. Provider adapters (Gmail today, Outlook/Proton later)
 * translate their UI events into these calls.
 */

const REGISTER_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

export interface TrackedSend {
  id: string;
  /** Outgoing HTML with old pixels removed and the new pixel appended. */
  body: string;
}

/**
 * Registers an outgoing email and returns the body to send. If the server can't be reached,
 * the email still goes out, just untracked: sending must never fail because of OpenTicks.
 */
export async function prepareTrackedSend(
  client: OpenTicksClient,
  input: {
    serverUrl: string;
    provider: ProviderId;
    account: string;
    subject: string;
    recipients: Recipient[];
    body: string;
  },
): Promise<TrackedSend | null> {
  const id = newTrackingId();
  try {
    await withTimeout(
      client.register({
        id,
        provider: input.provider,
        account: input.account,
        subject: input.subject,
        recipients: input.recipients,
      }),
      REGISTER_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn('[OpenTicks] could not register email, sending untracked:', error);
    return null;
  }
  return { id, body: stripPixels(input.body, input.serverUrl) + pixelHtml(input.serverUrl, id) };
}

/**
 * Tells the server the sender is looking at these pixels right now, so the resulting
 * image request isn't counted as the recipient reading the email.
 */
export function reportSelfViews(client: OpenTicksClient, root: ParentNode, serverUrl: string): void {
  const sources = [...root.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
  const ids = findPixelIds(sources, serverUrl);
  if (ids.length > 0) client.reportSelfViews(ids).catch(() => {});
}

export interface ThreadEntry {
  providerMessageId: string | null;
  sender: string | null;
}

/**
 * Finds recipients who replied after a tracked message in a thread. A reply proves they read it,
 * even when their mail app blocks images.
 */
export function findReplies(
  thread: ThreadEntry[],
  store: LiveStore,
  account: string,
): { messageId: string; email: string }[] {
  const replies: { messageId: string; email: string }[] = [];
  const me = account.toLowerCase();
  thread.forEach((entry, index) => {
    const tracked = entry.providerMessageId ? store.byProviderMessageId(entry.providerMessageId) : undefined;
    if (!tracked) return;
    const pending = new Set(
      tracked.recipients.filter((r) => r.readVia !== 'reply').map((r) => r.email.toLowerCase()),
    );
    for (const later of thread.slice(index + 1)) {
      const sender = later.sender?.toLowerCase();
      if (sender && sender !== me && pending.delete(sender)) {
        replies.push({ messageId: tracked.id, email: sender });
      }
    }
  });
  return replies;
}
