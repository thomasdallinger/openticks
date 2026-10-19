import type { LiveEvent } from '@openticks/core';

/** Content scripts and the popup talk to the server through the background worker. */
export interface ApiRequest {
  type: 'openticks:api';
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

export type ApiResponse =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

/** Long-lived port that streams live events from the background worker. */
export const LIVE_PORT = 'openticks:live';

export interface ConnectionState {
  type: 'connection';
  status: 'unconfigured' | 'connecting' | 'connected' | 'error';
  error?: string;
}

export type PortEvent = LiveEvent | ConnectionState;
