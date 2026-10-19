import * as InboxSDK from '@inboxsdk/core';
import { client } from '../../lib/client.ts';
import { connectLiveStore, LiveStore } from '../../lib/live-store.ts';
import type { MailProvider } from '../types.ts';
import { setupCompose } from './compose.ts';
import { setupViews } from './views.ts';

/** Register your own id at https://register.inboxsdk.com for production builds. */
const INBOXSDK_APP_ID = import.meta.env.WXT_INBOXSDK_APP_ID || 'OpenTicks';

export const gmail: MailProvider = {
  id: 'gmail',
  async start({ settings }) {
    const sdk = await InboxSDK.load(2, INBOXSDK_APP_ID, {
      appName: 'OpenTicks',
      // OpenTicks is a privacy tool: don't send usage analytics or error logs to InboxSDK.
      eventTracking: false,
      globalErrorLogging: false,
    });
    const account = sdk.User.getEmailAddress();
    const store = new LiveStore(account);
    connectLiveStore(store);

    setupCompose({ sdk, client, account, settings });
    setupViews({ sdk, client, store, account, settings });
  },
};
