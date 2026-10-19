import type { TrackedMessage } from '@openticks/core';
import { browser } from 'wxt/browser';
import { LIVE_PORT, type ConnectionState, type PortEvent } from './protocol.ts';

type Listener = () => void;

/**
 * Client-side mirror of the server's tracked messages, kept current over the background
 * worker's live port. Provider adapters read from it and re-render on change.
 */
export class LiveStore {
  private messages = new Map<string, TrackedMessage>();
  private listeners = new Set<Listener>();
  connection: ConnectionState = { type: 'connection', status: 'connecting' };

  /** @param account only keep messages sent from this mailbox; all when omitted. */
  constructor(private readonly account?: string) {}

  apply(event: PortEvent): void {
    if (event.type === 'connection') {
      this.connection = event;
    } else if (event.type === 'snapshot') {
      this.messages.clear();
      for (const message of event.messages) this.keep(message);
    } else {
      this.keep(event.message);
    }
    for (const listener of this.listeners) listener();
  }

  private keep(message: TrackedMessage): void {
    if (this.account && message.account !== this.account.toLowerCase()) return;
    this.messages.set(message.id, message);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  all(): TrackedMessage[] {
    return [...this.messages.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): TrackedMessage | undefined {
    return this.messages.get(id);
  }

  byProviderMessageId(providerMessageId: string): TrackedMessage | undefined {
    for (const message of this.messages.values()) {
      if (message.providerMessageId === providerMessageId) return message;
    }
    return undefined;
  }

  /** The most recent tracked message in a thread, which is what a thread row shows. */
  latestInThread(providerThreadId: string): TrackedMessage | undefined {
    let latest: TrackedMessage | undefined;
    for (const message of this.messages.values()) {
      if (message.providerThreadId !== providerThreadId) continue;
      if (!latest || message.createdAt > latest.createdAt) latest = message;
    }
    return latest;
  }
}

/** Connects a store to the background worker and reconnects when the worker restarts. */
export function connectLiveStore(store: LiveStore): () => void {
  let stopped = false;
  let retryDelay = 500;
  let port: ReturnType<typeof browser.runtime.connect> | undefined;

  const connect = () => {
    if (stopped) return;
    port = browser.runtime.connect({ name: LIVE_PORT });
    port.onMessage.addListener((event: PortEvent) => {
      retryDelay = 500;
      store.apply(event);
    });
    port.onDisconnect.addListener(() => {
      port = undefined;
      store.apply({ type: 'connection', status: 'connecting' });
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    });
  };

  connect();
  return () => {
    stopped = true;
    port?.disconnect();
  };
}
