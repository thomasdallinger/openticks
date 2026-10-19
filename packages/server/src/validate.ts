import {
  isTrackingId,
  type MarkSentInput,
  type Recipient,
  type RegisterMessageInput,
  type ReplyInput,
  type SelfViewInput,
} from '@openticks/core';

export class ValidationError extends Error {}

const MAX_RECIPIENTS = 500;
const MAX_SELF_VIEW_IDS = 200;
const FIELDS = new Set(['to', 'cc', 'bcc']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function email(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(value)) {
    throw new ValidationError(`${name} must be an email address`);
  }
  return value;
}

function optionalString(value: unknown, name: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${name} must be a string`);
  return value.slice(0, max);
}

function optionalTimestamp(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${name} must be a timestamp`);
  }
  return value;
}

export function trackingId(value: unknown): string {
  if (typeof value !== 'string' || !isTrackingId(value)) throw new ValidationError('invalid id');
  return value;
}

export function parseRegister(body: unknown): RegisterMessageInput {
  if (!isObject(body)) throw new ValidationError('body must be an object');
  if (typeof body.provider !== 'string' || !/^[a-z0-9-]{1,32}$/.test(body.provider)) {
    throw new ValidationError('provider must be a short lowercase id');
  }
  if (!Array.isArray(body.recipients) || body.recipients.length > MAX_RECIPIENTS) {
    throw new ValidationError(`recipients must be an array of at most ${MAX_RECIPIENTS}`);
  }
  const recipients: Recipient[] = body.recipients.map((r: unknown, i) => {
    if (!isObject(r)) throw new ValidationError(`recipients[${i}] must be an object`);
    const field = r.field ?? 'to';
    if (typeof field !== 'string' || !FIELDS.has(field)) {
      throw new ValidationError(`recipients[${i}].field must be to, cc or bcc`);
    }
    const name = optionalString(r.name, `recipients[${i}].name`, 200);
    return {
      email: email(r.email, `recipients[${i}].email`),
      field: field as Recipient['field'],
      ...(name ? { name } : {}),
    };
  });
  return {
    id: trackingId(body.id),
    provider: body.provider,
    account: email(body.account, 'account'),
    subject: optionalString(body.subject, 'subject', 500),
    recipients,
  };
}

export function parseMarkSent(body: unknown): MarkSentInput {
  if (!isObject(body)) throw new ValidationError('body must be an object');
  const sentAt = optionalTimestamp(body.sentAt, 'sentAt');
  return {
    providerMessageId: optionalString(body.providerMessageId, 'providerMessageId', 200),
    providerThreadId: optionalString(body.providerThreadId, 'providerThreadId', 200),
    ...(sentAt === undefined ? {} : { sentAt }),
  };
}

export function parseReply(body: unknown): ReplyInput {
  if (!isObject(body)) throw new ValidationError('body must be an object');
  const at = optionalTimestamp(body.at, 'at');
  return { email: email(body.email, 'email'), ...(at === undefined ? {} : { at }) };
}

export function parseSelfViews(body: unknown): SelfViewInput {
  if (!isObject(body) || !Array.isArray(body.ids) || body.ids.length > MAX_SELF_VIEW_IDS) {
    throw new ValidationError(`ids must be an array of at most ${MAX_SELF_VIEW_IDS}`);
  }
  return { ids: body.ids.map(trackingId) };
}
