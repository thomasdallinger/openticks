import type {
  MarkSentInput,
  RegisterMessageInput,
  ServerInfo,
  TrackedMessage,
} from '@openticks/core';
import { browser } from 'wxt/browser';
import type { ApiRequest, ApiResponse } from './protocol.ts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: ApiRequest['method'], path: string, body?: unknown): Promise<T> {
  const request: ApiRequest = { type: 'openticks:api', method, path, body };
  const response = (await browser.runtime.sendMessage(request)) as ApiResponse | undefined;
  if (!response) throw new ApiError('OpenTicks background worker did not answer', 0);
  if (!response.ok) throw new ApiError(response.error, response.status);
  return response.data as T;
}

/** Server API as seen from content scripts and the popup. Requests are proxied by the background worker. */
export const client = {
  info: () => call<ServerInfo>('GET', '/api/info'),
  listMessages: (limit = 20) => call<TrackedMessage[]>('GET', `/api/messages?limit=${limit}`),
  register: (input: RegisterMessageInput) => call<TrackedMessage>('POST', '/api/messages', input),
  markSent: (id: string, input: MarkSentInput) =>
    call<TrackedMessage>('POST', `/api/messages/${id}/sent`, input),
  reportReply: (id: string, email: string) =>
    call<void>('POST', `/api/messages/${id}/replies`, { email }),
  reportSelfViews: (ids: string[]) => call<void>('POST', '/api/self-views', { ids }),
};

export type OpenTicksClient = typeof client;
