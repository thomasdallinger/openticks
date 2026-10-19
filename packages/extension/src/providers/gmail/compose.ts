import type { ComposeView, InboxSDK } from '@inboxsdk/core';
import { stripPixels, type Recipient } from '@openticks/core';
import type { OpenTicksClient } from '../../lib/client.ts';
import { createValue } from '../../lib/observe.ts';
import { isConfigured, type Settings } from '../../lib/settings.ts';
import { tickDataUrl } from '../../lib/ticks.ts';
import { prepareTrackedSend } from '../../lib/tracker.ts';

/**
 * - `track`: one email, one pixel. Exact for one recipient, best guess for several.
 * - `individual`: every recipient gets their own copy and pixel, so ticks are exact per person.
 * - `off`: send untracked.
 */
type Mode = 'track' | 'individual' | 'off';

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'track', label: 'Track opens', hint: 'One email to everyone' },
  {
    mode: 'individual',
    label: 'Track each recipient',
    hint: 'Sends everyone a separate copy, so you see exactly who opened it',
  },
  { mode: 'off', label: "Don't track", hint: 'Send this email without a pixel' },
];

const BUTTON_TITLE: Record<Mode, string> = {
  track: 'OpenTicks: tracking opens',
  individual: 'OpenTicks: tracking each recipient',
  off: 'OpenTicks: not tracking',
};

export interface ComposeDeps {
  sdk: InboxSDK;
  client: OpenTicksClient;
  account: string;
  settings: Settings;
}

function collectRecipients(compose: ComposeView): Recipient[] {
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  const add = (field: Recipient['field'], contacts: { emailAddress: string; name?: string | null }[]) => {
    for (const contact of contacts) {
      const email = contact.emailAddress.toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      recipients.push({ email, field, ...(contact.name ? { name: contact.name } : {}) });
    }
  };
  add('to', compose.getToRecipients());
  add('cc', compose.getCcRecipients());
  add('bcc', compose.getBccRecipients());
  return recipients;
}

/**
 * Gmail has no API for attachments in a compose window, so this looks for Gmail's attachment
 * chips. Copies made by "Track each recipient" don't carry attachments yet, so we refuse to split.
 */
function hasAttachments(compose: ComposeView): boolean {
  return Boolean(compose.getElement().querySelector('input[name="attach"], div[download_url]'));
}

const attached = new WeakSet<ComposeView>();

/** Adds tracking to one compose window. Idempotent, so individual copies can call it explicitly. */
function attachTracking(compose: ComposeView, deps: ComposeDeps): void {
  if (attached.has(compose)) return;
  attached.add(compose);
  const { sdk, client, account, settings } = deps;

  const mode = createValue<Mode>('track');
  let pending: { subject: string; recipients: Recipient[] } | null = null;
  let trackedId: string | null = null;

  compose.addButton(
    mode.property.map((current) => ({
      title: isConfigured(settings) ? BUTTON_TITLE[current] : 'OpenTicks: connect a server first',
      iconUrl: tickDataUrl(current === 'off' ? 'sent' : 'read', 20),
      type: 'MODIFIER' as const,
      hasDropdown: true,
      onClick(event: { dropdown?: { el: HTMLElement; close(): void } }) {
        const dropdown = event.dropdown;
        if (!dropdown) return;
        dropdown.el.append(
          renderModeMenu(mode.get(), compose.isReply(), settings, (next) => {
            mode.set(next);
            dropdown.close();
          }),
        );
      },
    })),
  );

  compose.on('presending', (event) => {
    pending = { subject: compose.getSubject(), recipients: collectRecipients(compose) };
    const split = mode.get() === 'individual' && pending.recipients.length > 1 && !compose.isReply();
    if (split && isConfigured(settings)) {
      event.cancel();
      void sendIndividually(compose, pending.recipients, deps);
    }
  });

  compose.registerRequestModifier(async ({ body, isPlainText }) => {
    if (!isConfigured(settings) || isPlainText) return { body };
    const cleaned = stripPixels(body, settings.serverUrl);
    if (mode.get() === 'off') return { body: cleaned };
    const send = pending ?? { subject: compose.getSubject(), recipients: collectRecipients(compose) };
    const tracked = await prepareTrackedSend(client, {
      serverUrl: settings.serverUrl,
      provider: 'gmail',
      account,
      subject: send.subject,
      recipients: send.recipients,
      body,
    });
    if (!tracked) {
      sdk.ButterBar.showError({ text: 'OpenTicks server unreachable, this email was sent without tracking.' });
      return { body: cleaned };
    }
    trackedId = tracked.id;
    return { body: tracked.body };
  });

  compose.on('sent', async (event) => {
    const id = trackedId;
    trackedId = null;
    if (!id) return;
    const [providerMessageId, providerThreadId] = await Promise.all([
      event.getMessageID(),
      event.getThreadID(),
    ]);
    await client
      .markSent(id, { providerMessageId, providerThreadId, sentAt: Date.now() })
      .catch((error) => console.warn('[OpenTicks] could not confirm sent email:', error));
  });
}

function renderModeMenu(
  current: Mode,
  isReply: boolean,
  settings: Settings,
  choose: (mode: Mode) => void,
): HTMLElement {
  const menu = document.createElement('div');
  menu.style.cssText = 'padding:6px 0;min-width:260px;font:14px/1.4 system-ui,sans-serif;background:#fff';
  if (!isConfigured(settings)) {
    menu.style.padding = '12px 16px';
    menu.textContent = 'Click the OpenTicks icon in your browser toolbar to connect your server.';
    return menu;
  }
  for (const option of MODES) {
    const disabled = option.mode === 'individual' && isReply;
    const item = document.createElement('button');
    item.type = 'button';
    item.disabled = disabled;
    item.style.cssText = `display:block;width:100%;text-align:left;border:0;background:${
      option.mode === current ? '#e8f0fe' : 'transparent'
    };padding:8px 16px;cursor:${disabled ? 'default' : 'pointer'};opacity:${disabled ? 0.5 : 1};font:inherit`;
    const label = document.createElement('div');
    label.style.fontWeight = '500';
    label.textContent = `${option.mode === current ? '● ' : ''}${option.label}`;
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;color:#5f6368';
    hint.textContent = disabled ? 'Not available for replies' : option.hint;
    item.append(label, hint);
    item.addEventListener('click', () => choose(option.mode));
    menu.append(item);
  }
  return menu;
}

function sendAndWait(compose: ComposeView, timeoutMs = 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    compose.on('sent', () => {
      clearTimeout(timer);
      resolve(true);
    });
    compose.on('sendCanceled', () => {
      clearTimeout(timer);
      resolve(false);
    });
    compose.send();
  });
}

/** Sends one tracked copy per recipient, then discards the original draft. */
async function sendIndividually(original: ComposeView, recipients: Recipient[], deps: ComposeDeps) {
  const { sdk } = deps;
  if (hasAttachments(original)) {
    sdk.ButterBar.showError({
      text: 'OpenTicks: "Track each recipient" can\'t send attachments yet. Remove them or choose "Track opens".',
    });
    return;
  }
  const subject = original.getSubject();
  const html = original.getHTMLContent();
  const from = original.getFromContact().emailAddress;
  const progress = sdk.ButterBar.showMessage({
    text: `OpenTicks: sending ${recipients.length} individual copies…`,
    persistent: true,
  });

  let sent = 0;
  try {
    original.setMinimized(true);
    for (const recipient of recipients) {
      const copy = await sdk.Compose.openNewComposeView();
      attachTracking(copy, deps);
      if (copy.getFromContact().emailAddress !== from) copy.setFromEmail(from);
      copy.setToRecipients([recipient.email]);
      copy.setSubject(subject);
      copy.setBodyHTML(html);
      if (!(await sendAndWait(copy))) break;
      sent++;
    }
  } finally {
    progress.destroy();
  }

  if (sent === recipients.length) {
    original.discard();
    sdk.ButterBar.showMessage({ text: `OpenTicks: sent ${sent} individual copies.` });
  } else {
    original.setMinimized(false);
    sdk.ButterBar.showError({
      text: `OpenTicks: only ${sent} of ${recipients.length} copies were sent. The original draft is still open.`,
    });
  }
}

export function setupCompose(deps: ComposeDeps): void {
  deps.sdk.Compose.registerComposeViewHandler((compose) => attachTracking(compose, deps));
}
