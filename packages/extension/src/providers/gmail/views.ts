import type { InboxSDK, MessageView } from '@inboxsdk/core';
import { tickState } from '@openticks/core';
import type { OpenTicksClient } from '../../lib/client.ts';
import type { LiveStore } from '../../lib/live-store.ts';
import { untilDestroyed, watchStore } from '../../lib/observe.ts';
import type { Settings } from '../../lib/settings.ts';
import { tickDataUrl, tickSvg, tooltipElement, tooltipText } from '../../lib/ticks.ts';
import { findReplies, reportSelfViews, type ThreadEntry } from '../../lib/tracker.ts';

export interface ViewDeps {
  sdk: InboxSDK;
  client: OpenTicksClient;
  store: LiveStore;
  account: string;
  settings: Settings;
}

/** Ticks next to the subject in every thread list (Inbox, Sent, labels, search). */
function setupThreadRows({ sdk, store }: ViewDeps): void {
  sdk.Lists.registerThreadRowViewHandler(async (row) => {
    const threadId = await row.getThreadIDIfStableAsync();
    if (!threadId) return;
    const ticks = watchStore(store, () => store.latestInThread(threadId)).map((message) =>
      message
        ? { imageUrl: tickDataUrl(tickState(message)), tooltip: tooltipText(message), orderHint: -100 }
        : null,
    );
    row.addImage(untilDestroyed(ticks, row) as never);
  });
}

/** Ticks with a per-recipient breakdown in the header of each sent message. */
function setupMessageViews({ sdk, client, store, settings }: ViewDeps): void {
  sdk.Conversations.registerMessageViewHandler(async (view: MessageView) => {
    if (settings.serverUrl) reportSelfViews(client, view.getBodyElement(), settings.serverUrl);
    const messageId = await view.getMessageIDAsync();
    const ticks = watchStore(store, () => store.byProviderMessageId(messageId))
      .filter((message) => message !== undefined)
      .map((message) => ({
        iconHtml: `<span style="display:inline-flex;vertical-align:middle">${tickSvg(tickState(message!), 18)}</span>`,
        tooltip: tooltipElement(message!),
      }));
    view.addAttachmentIcon(untilDestroyed(ticks, view) as never);
  });
}

/** A recipient replying in the thread is proof they read the email. */
function setupReplyDetection({ sdk, client, store, account }: ViewDeps): void {
  sdk.Conversations.registerThreadViewHandler(async (thread) => {
    const entries: ThreadEntry[] = await Promise.all(
      thread.getMessageViewsAll().map(async (view) => ({
        providerMessageId: await view.getMessageIDAsync().catch(() => null),
        sender: safe(() => view.getSender().emailAddress),
      })),
    );
    for (const reply of findReplies(entries, store, account)) {
      client.reportReply(reply.messageId, reply.email).catch(() => {});
    }
  });
}

function safe<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function setupViews(deps: ViewDeps): void {
  setupThreadRows(deps);
  setupMessageViews(deps);
  setupReplyDetection(deps);
}
