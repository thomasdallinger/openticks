/** Mail providers OpenTicks can integrate with. Only `gmail` ships today. */
export type ProviderId = 'gmail' | 'outlook' | 'proton' | (string & {});

export type RecipientField = 'to' | 'cc' | 'bcc';

/**
 * How we know a recipient read the message.
 * - `open`: the tracking pixel loaded and only this recipient could have loaded it.
 * - `likely-open`: the pixel loaded through a mail provider proxy that only this recipient uses.
 * - `reply`: the recipient replied in the same thread.
 */
export type ReadVia = 'open' | 'likely-open' | 'reply';

export interface Recipient {
  email: string;
  name?: string;
  field: RecipientField;
}

export interface RecipientStatus extends Recipient {
  readAt: number | null;
  readVia: ReadVia | null;
}

export interface OpenStats {
  /** Counted opens, excluding the sender's own views. */
  count: number;
  /** Counted opens we could not attribute to a specific recipient. */
  unattributed: number;
  firstAt: number | null;
  lastAt: number | null;
}

/** One sent email with a single tracking pixel. All timestamps are epoch milliseconds. */
export interface TrackedMessage {
  id: string;
  provider: ProviderId;
  /** Sender address of the mailbox the message was sent from. */
  account: string;
  subject: string | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
  createdAt: number;
  sentAt: number | null;
  recipients: RecipientStatus[];
  opens: OpenStats;
}

export interface RegisterMessageInput {
  id: string;
  provider: ProviderId;
  account: string;
  subject?: string | null;
  recipients: Recipient[];
}

export interface MarkSentInput {
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  sentAt?: number;
}

export interface ReplyInput {
  email: string;
  at?: number;
}

export interface SelfViewInput {
  ids: string[];
}

/** Messages pushed over the `/api/live` WebSocket. */
export type LiveEvent =
  | { type: 'snapshot'; messages: TrackedMessage[] }
  | { type: 'message'; message: TrackedMessage };

export interface ServerInfo {
  name: 'openticks';
  version: string;
}
