import { Database } from 'bun:sqlite';
import type {
  MarkSentInput,
  ReadVia,
  RecipientField,
  RegisterMessageInput,
  TrackedMessage,
} from '@openticks/core';
import {
  classifyOpenClient,
  PROXY_HOST,
  type MailHost,
  type MailHostResolver,
  type OpenClient,
} from './mail-hosts.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account TEXT NOT NULL,
  subject TEXT,
  provider_message_id TEXT,
  provider_thread_id TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_account ON messages (account, created_at);

CREATE TABLE IF NOT EXISTS recipients (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  field TEXT NOT NULL,
  mail_host TEXT,
  read_at INTEGER,
  read_via TEXT,
  PRIMARY KEY (message_id, email)
);

CREATE TABLE IF NOT EXISTS opens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  client TEXT NOT NULL,
  state TEXT NOT NULL,
  attributed_to TEXT
);
CREATE INDEX IF NOT EXISTS idx_opens_state ON opens (state, at);
CREATE INDEX IF NOT EXISTS idx_opens_message ON opens (message_id);

CREATE TABLE IF NOT EXISTS self_views (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_self_views ON self_views (message_id, at);
`;

/** `pending` opens wait `settleMs`, then become `counted`, `self` (sender's own view) or `early` (scanner). */
type OpenState = 'pending' | 'counted' | 'self' | 'early';

interface MessageRow {
  id: string;
  provider: string;
  account: string;
  subject: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  created_at: number;
  sent_at: number | null;
}

interface RecipientRow {
  email: string;
  name: string | null;
  field: RecipientField;
  mail_host: MailHost | null;
  read_at: number | null;
  read_via: ReadVia | null;
}

interface PendingOpenRow {
  id: number;
  message_id: string;
  at: number;
  client: OpenClient;
  sent_at: number | null;
}

export interface StoreOptions {
  settleMs: number;
  selfViewWindowMs: number;
  minOpenDelayMs: number;
  resolveMailHost: MailHostResolver;
}

export class TrackingStore {
  readonly db: Database;

  constructor(
    path: string,
    private readonly options: StoreOptions,
  ) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.run(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** Idempotent: registering the same id twice keeps the first registration. */
  register(input: RegisterMessageInput, now: number): TrackedMessage {
    const account = input.account.toLowerCase();
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT OR IGNORE INTO messages (id, provider, account, subject, created_at)
           VALUES ($id, $provider, $account, $subject, $now)`,
        )
        .run({ id: input.id, provider: input.provider, account, subject: input.subject ?? null, now });
      const insertRecipient = this.db.query(
        `INSERT OR IGNORE INTO recipients (message_id, email, name, field)
         VALUES ($id, $email, $name, $field)`,
      );
      for (const r of input.recipients) {
        insertRecipient.run({ id: input.id, email: r.email.toLowerCase(), name: r.name ?? null, field: r.field });
      }
    })();
    void this.resolveMailHosts(input.id);
    return this.get(input.id)!;
  }

  private async resolveMailHosts(messageId: string): Promise<void> {
    const rows = this.db
      .query<{ email: string }, { id: string }>(
        'SELECT email FROM recipients WHERE message_id = $id AND mail_host IS NULL',
      )
      .all({ id: messageId });
    await Promise.all(
      rows.map(async ({ email }) => {
        const domain = email.split('@')[1];
        if (!domain) return;
        const host = await this.options.resolveMailHost(domain);
        this.db
          .query('UPDATE recipients SET mail_host = $host WHERE message_id = $id AND email = $email')
          .run({ host, id: messageId, email });
      }),
    );
  }

  markSent(id: string, input: MarkSentInput, now: number): TrackedMessage | null {
    this.db
      .query(
        `UPDATE messages SET
           provider_message_id = COALESCE($messageId, provider_message_id),
           provider_thread_id = COALESCE($threadId, provider_thread_id),
           sent_at = COALESCE(sent_at, $sentAt)
         WHERE id = $id`,
      )
      .run({
        id,
        messageId: input.providerMessageId ?? null,
        threadId: input.providerThreadId ?? null,
        sentAt: input.sentAt ?? now,
      });
    return this.get(id);
  }

  /** Records a pixel hit. Returns false for unknown ids. */
  recordOpen(id: string, userAgent: string | null, now: number): boolean {
    const result = this.db
      .query(
        `INSERT INTO opens (message_id, at, client, state)
         SELECT id, $now, $client, 'pending' FROM messages WHERE id = $id`,
      )
      .run({ id, now, client: classifyOpenClient(userAgent) });
    return result.changes > 0;
  }

  recordSelfViews(ids: string[], now: number): void {
    const insert = this.db.query(
      `INSERT INTO self_views (message_id, at) SELECT id, $now FROM messages WHERE id = $id`,
    );
    this.db.transaction(() => {
      for (const id of ids) insert.run({ id, now });
    })();
  }

  /** A reply from a recipient is proof they read it. Returns the message if anything changed. */
  recordReply(id: string, email: string, at: number): TrackedMessage | null {
    const result = this.db
      .query(
        `UPDATE recipients SET read_at = MIN(COALESCE(read_at, $at), $at), read_via = 'reply'
         WHERE message_id = $id AND email = $email AND (read_via IS NULL OR read_via != 'reply')`,
      )
      .run({ id, email: email.toLowerCase(), at });
    return result.changes > 0 ? this.get(id) : null;
  }

  /** Decides the fate of opens older than `settleMs`. Returns ids of messages whose status changed. */
  settle(now: number): string[] {
    const { settleMs, selfViewWindowMs, minOpenDelayMs } = this.options;
    const pending = this.db
      .query<PendingOpenRow, { before: number }>(
        `SELECT o.id, o.message_id, o.at, o.client, m.sent_at
         FROM opens o JOIN messages m ON m.id = o.message_id
         WHERE o.state = 'pending' AND o.at <= $before
         ORDER BY o.at`,
      )
      .all({ before: now - settleMs });

    const changed = new Set<string>();
    const selfViewed = this.db.query<{ n: number }, { id: string; from: number; to: number }>(
      'SELECT COUNT(*) AS n FROM self_views WHERE message_id = $id AND at BETWEEN $from AND $to',
    );
    const setState = this.db.query(
      'UPDATE opens SET state = $state, attributed_to = $email WHERE id = $id',
    );

    this.db.transaction(() => {
      for (const open of pending) {
        let state: OpenState = 'counted';
        let attributedTo: string | null = null;
        const window = { id: open.message_id, from: open.at - selfViewWindowMs, to: open.at + selfViewWindowMs };
        if (selfViewed.get(window)!.n > 0) {
          state = 'self';
        } else if (open.sent_at !== null && open.at < open.sent_at + minOpenDelayMs) {
          state = 'early';
        } else {
          const reader = this.attribute(open);
          if (reader) {
            attributedTo = reader.email;
            this.markRead(open.message_id, reader.email, open.at, reader.via);
          }
          changed.add(open.message_id);
        }
        setState.run({ state, email: attributedTo, id: open.id });
      }
    })();
    return [...changed];
  }

  /** The single recipient, or the only recipient whose mail host matches the proxy the open came through. */
  private attribute(open: PendingOpenRow): { email: string; via: ReadVia } | null {
    const recipients = this.recipients(open.message_id);
    if (recipients.length === 1) return { email: recipients[0]!.email, via: 'open' };
    const host = PROXY_HOST[open.client];
    if (!host) return null;
    const candidates = recipients.filter((r) => r.mail_host === host);
    return candidates.length === 1 ? { email: candidates[0]!.email, via: 'likely-open' } : null;
  }

  private markRead(messageId: string, email: string, at: number, via: ReadVia): void {
    this.db
      .query(
        `UPDATE recipients SET read_at = $at, read_via = $via
         WHERE message_id = $id AND email = $email AND read_at IS NULL`,
      )
      .run({ at, via, id: messageId, email });
  }

  private recipients(messageId: string): RecipientRow[] {
    return this.db
      .query<RecipientRow, { id: string }>(
        `SELECT email, name, field, mail_host, read_at, read_via
         FROM recipients WHERE message_id = $id ORDER BY rowid`,
      )
      .all({ id: messageId });
  }

  get(id: string): TrackedMessage | null {
    const row = this.db
      .query<MessageRow, { id: string }>('SELECT * FROM messages WHERE id = $id')
      .get({ id });
    return row ? this.toMessage(row) : null;
  }

  list(filter: { account?: string; limit: number }): TrackedMessage[] {
    const rows = filter.account
      ? this.db
          .query<MessageRow, { account: string; limit: number }>(
            'SELECT * FROM messages WHERE account = $account ORDER BY created_at DESC LIMIT $limit',
          )
          .all({ account: filter.account.toLowerCase(), limit: filter.limit })
      : this.db
          .query<MessageRow, { limit: number }>(
            'SELECT * FROM messages ORDER BY created_at DESC LIMIT $limit',
          )
          .all({ limit: filter.limit });
    return rows.map((row) => this.toMessage(row));
  }

  purge(olderThan: number): void {
    this.db.query('DELETE FROM messages WHERE created_at < $olderThan').run({ olderThan });
  }

  private toMessage(row: MessageRow): TrackedMessage {
    const opens = this.db
      .query<
        { count: number; unattributed: number; first_at: number | null; last_at: number | null },
        { id: string }
      >(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(attributed_to IS NULL), 0) AS unattributed,
                MIN(at) AS first_at, MAX(at) AS last_at
         FROM opens WHERE message_id = $id AND state = 'counted'`,
      )
      .get({ id: row.id })!;
    return {
      id: row.id,
      provider: row.provider,
      account: row.account,
      subject: row.subject,
      providerMessageId: row.provider_message_id,
      providerThreadId: row.provider_thread_id,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      recipients: this.recipients(row.id).map((r) => ({
        email: r.email,
        ...(r.name ? { name: r.name } : {}),
        field: r.field,
        readAt: r.read_at,
        readVia: r.read_via,
      })),
      opens: {
        count: opens.count,
        unattributed: opens.unattributed,
        firstAt: opens.first_at,
        lastAt: opens.last_at,
      },
    };
  }
}
