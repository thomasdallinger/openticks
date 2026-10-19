import type { LiveEvent, TrackedMessage } from '@openticks/core';
import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { LIVE_PORT, type ApiRequest, type ApiResponse, type ConnectionState, type PortEvent } from '../lib/protocol.ts';
import { isConfigured, settingsItem, type Settings } from '../lib/settings.ts';

type Port = Browser.runtime.Port;

const PING_INTERVAL_MS = 20_000; // also keeps the MV3 service worker alive while connected
const MAX_RETRY_MS = 30_000;

async function handleApi(request: ApiRequest): Promise<ApiResponse> {
  const settings = await settingsItem.getValue();
  if (!isConfigured(settings)) return { ok: false, status: 0, error: 'OpenTicks is not connected to a server yet' };
  try {
    const res = await fetch(`${settings.serverUrl}${request.path}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${settings.accessKey}`,
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) return { ok: false, status: res.status, error: data?.error ?? res.statusText };
    return { ok: true, status: res.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: `Can't reach ${settings.serverUrl} (${String(error)})` };
  }
}

/**
 * One WebSocket to the server, fanned out to every Gmail tab and the popup over runtime ports.
 * Holds the latest snapshot so new ports render immediately.
 */
class LiveHub {
  private ports = new Set<Port>();
  private messages = new Map<string, TrackedMessage>();
  private state: ConnectionState = { type: 'connection', status: 'unconfigured' };
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 1000;

  attach(port: Port): void {
    this.ports.add(port);
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
      if (this.ports.size === 0) this.disconnect();
    });
    port.postMessage(this.state);
    port.postMessage({ type: 'snapshot', messages: [...this.messages.values()] } satisfies LiveEvent);
    if (!this.socket) void this.connect();
  }

  async reconnect(): Promise<void> {
    this.disconnect();
    this.messages.clear();
    if (this.ports.size > 0) await this.connect();
  }

  private broadcast(event: PortEvent): void {
    for (const port of this.ports) port.postMessage(event);
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.broadcast(state);
  }

  private async connect(): Promise<void> {
    clearTimeout(this.retryTimer);
    const settings: Settings = await settingsItem.getValue();
    if (!isConfigured(settings)) return this.setState({ type: 'connection', status: 'unconfigured' });
    if (this.socket) return;

    this.setState({ type: 'connection', status: 'connecting' });
    const url = new URL('/api/live', settings.serverUrl);
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    url.searchParams.set('key', settings.accessKey);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.retryDelay = 1000;
      this.setState({ type: 'connection', status: 'connected' });
      this.pingTimer = setInterval(() => socket.send('ping'), PING_INTERVAL_MS);
    };
    socket.onmessage = (msg) => {
      if (msg.data === 'pong') return;
      const event = JSON.parse(String(msg.data)) as LiveEvent;
      if (event.type === 'snapshot') {
        this.messages = new Map(event.messages.map((m) => [m.id, m]));
      } else {
        this.messages.set(event.message.id, event.message);
      }
      this.broadcast(event);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.pingTimer);
      const error = event.code === 1006 ? `Can't reach ${settings.serverUrl}` : event.reason || undefined;
      this.setState({ type: 'connection', status: 'error', ...(error ? { error } : {}) });
      if (this.ports.size > 0) {
        this.retryTimer = setTimeout(() => void this.connect(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
      }
    };
  }

  private disconnect(): void {
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}

export default defineBackground(() => {
  const hub = new LiveHub();

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const request = message as { type?: string };
    if (request?.type === 'openticks:api') {
      handleApi(message as ApiRequest).then(sendResponse);
      return true;
    }
    // Same contract as @inboxsdk/core/background.js: run InboxSDK's page-world script in Gmail.
    if (request?.type === 'inboxsdk__injectPageWorld' && sender.tab?.id !== undefined) {
      void browser.scripting.executeScript({
        target: sender.documentId
          ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
          : { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
        world: 'MAIN',
        // Copied from @inboxsdk/core by the build hook in wxt.config.ts, so WXT's types don't know it.
        files: ['pageWorld.js' as never],
      });
      sendResponse(true);
    }
    return undefined;
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === LIVE_PORT) hub.attach(port);
  });

  settingsItem.watch(() => void hub.reconnect());
});
