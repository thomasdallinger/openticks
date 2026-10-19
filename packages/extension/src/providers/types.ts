import type { ProviderId } from '@openticks/core';
import type { Settings } from '../lib/settings.ts';

/**
 * A mail provider adapter wires a webmail UI to OpenTicks:
 * 1. add a tracking pixel to outgoing mail (see `prepareTrackedSend`)
 * 2. report the provider's message/thread ids once sent
 * 3. render ticks next to sent messages from the `LiveStore`
 * 4. report self-views and replies (see `reportSelfViews`, `findReplies`)
 *
 * Gmail is the first adapter. Outlook and Proton Mail adapters go next to it in `src/providers/`.
 */
export interface MailProvider {
  id: ProviderId;
  start(context: ProviderContext): Promise<void>;
}

export interface ProviderContext {
  /** Latest settings; updated in place when the user changes them in the popup. */
  settings: Settings;
}
