import type { TrackedMessage } from './types.ts';

/**
 * WhatsApp-style tick states.
 * - `pending`: registered, not confirmed sent yet (undo window, scheduled send)
 * - `sent`: one grey tick
 * - `partial`: two grey ticks, opened by some recipients or by someone we can't identify
 * - `read`: two blue ticks, every recipient read it
 */
export type TickState = 'pending' | 'sent' | 'partial' | 'read';

export function readCount(message: TrackedMessage): { read: number; total: number } {
  const total = Math.max(message.recipients.length, 1);
  const read = message.recipients.filter((r) => r.readAt !== null).length;
  return { read, total };
}

export function tickState(message: TrackedMessage): TickState {
  if (message.sentAt === null && message.opens.count === 0) return 'pending';
  const { read, total } = readCount(message);
  if (read >= total) return 'read';
  if (read > 0 || message.opens.unattributed > 0) return 'partial';
  return 'sent';
}

/** One-line human summary, e.g. "Read by 2 of 3". */
export function statusLine(message: TrackedMessage): string {
  const { read, total } = readCount(message);
  switch (tickState(message)) {
    case 'pending':
      return 'Sending…';
    case 'sent':
      return 'Sent · not opened yet';
    case 'read':
      return total === 1 ? 'Read' : `Read by all ${total}`;
    case 'partial': {
      const parts: string[] = [];
      if (read > 0) parts.push(`Read by ${read} of ${total}`);
      if (message.opens.unattributed > 0) {
        parts.push(`opened ${message.opens.unattributed}× by someone`);
      }
      const line = parts.join(' · ');
      return line.charAt(0).toUpperCase() + line.slice(1);
    }
  }
}
