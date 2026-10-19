import {
  statusLine,
  type ReadVia,
  type RecipientStatus,
  type TickState,
  type TrackedMessage,
} from '@openticks/core';

export const TICK_GREY = '#8696a0';
export const TICK_BLUE = '#53bdeb';

const SHAPES: Record<'single' | 'double' | 'clock', string[]> = {
  single: ['M2 8.6l3.3 3.3L11.8 4.4'],
  double: ['M1 8.6l3.3 3.3L10.8 4.4', 'M7.7 11.2l.7.7L14.9 4.4'],
  clock: ['M13.6 8a5.6 5.6 0 1 1-11.2 0 5.6 5.6 0 0 1 11.2 0z', 'M8 5v3.2l2 1.3'],
};

/** Stroke paths (16×16 viewBox) and colour of a tick icon. Shared by the SVG string and `TickIcon.svelte`. */
export function tickShape(state: TickState): { paths: string[]; color: string } {
  const shape = state === 'pending' ? 'clock' : state === 'sent' ? 'single' : 'double';
  return { paths: SHAPES[shape], color: state === 'read' ? TICK_BLUE : TICK_GREY };
}

/** WhatsApp-style tick icon as an SVG string, for places that need markup (Gmail's UI). */
export function tickSvg(state: TickState, size = 16): string {
  const { paths, color } = tickShape(state);
  const body = paths.map((d) => `<path d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${stateLabel(state)}">${body}</svg>`;
}

export function tickDataUrl(state: TickState, size = 16): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tickSvg(state, size))}`;
}

export function stateLabel(state: TickState): string {
  return { pending: 'Sending', sent: 'Sent', partial: 'Partially read', read: 'Read' }[state];
}

const VIA_LABEL: Record<ReadVia, string> = {
  open: 'opened',
  'likely-open': 'probably opened',
  reply: 'replied',
};

export function formatTime(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function recipientLine(recipient: RecipientStatus): string {
  const who = recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email;
  if (recipient.readAt === null || recipient.readVia === null) return `✓ ${who} · not opened yet`;
  return `✓✓ ${who} · ${VIA_LABEL[recipient.readVia]} ${formatTime(recipient.readAt)}`;
}

/** Plain-text summary for native tooltips. */
export function tooltipText(message: TrackedMessage): string {
  const lines = [`OpenTicks · ${statusLine(message)}`];
  if (message.recipients.length > 1 || message.recipients[0]?.readAt) {
    lines.push(...message.recipients.map(recipientLine));
  }
  if (message.opens.count > 0 && message.opens.lastAt) {
    lines.push(`Opened ${message.opens.count}× · last ${formatTime(message.opens.lastAt)}`);
  }
  return lines.join('\n');
}

/** Rich tooltip card. Built with textContent only: names and subjects are untrusted. */
export function tooltipElement(message: TrackedMessage): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = 'font:13px/1.45 system-ui,sans-serif;padding:6px 4px;max-width:340px;white-space:normal';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;margin-bottom:4px';
  title.textContent = statusLine(message);
  card.append(title);

  for (const recipient of message.recipients) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center';
    const icon = document.createElement('span');
    icon.innerHTML = tickSvg(recipient.readAt ? 'read' : 'sent', 14);
    const text = document.createElement('span');
    text.textContent = recipientLine(recipient).replace(/^✓✓? /, '');
    row.append(icon, text);
    card.append(row);
  }

  if (message.opens.unattributed > 0) {
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:4px;opacity:.75';
    note.textContent = `Opened ${message.opens.unattributed}× by a recipient we couldn't identify. Use "Track each recipient" for exact results.`;
    card.append(note);
  }
  return card;
}

