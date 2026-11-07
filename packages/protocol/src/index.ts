import { randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import schema from '../schemas/message.schema.json' with { type: 'json' };

export type Slot = { start: string; end: string };
export type Payloads = {
  REQUEST: { participantAgentIds: string[]; durationMinutes: number; window: Slot };
  PROPOSE: { phase: 'AVAILABILITY'; slots: Slot[] } | { phase: 'SELECTION'; slot: Slot };
  ACCEPT: { proposalMessageId: string };
  REJECT: { reasonCode: 'NO_AVAILABILITY' | 'DECLINED' | 'INVALID_REQUEST' };
  CONFIRM: { phase: 'PREPARE'; proposalMessageId: string; slot: Slot }
    | { phase: 'COMMIT'; decisionId: string; slot: Slot }
    | { phase: 'APPLIED'; decisionId: string };
  ACK: { ackForMessageId: string; scope: 'relay.persisted' | 'recipient.persisted' };
};
export type MessageType = keyof Payloads;
export type Message = { [T in MessageType]: {
  protocolVersion: '1'; messageId: string; meetingId: string;
  fromAgentId: string; toAgentId: string; type: T; sequence: number;
  createdAt: string; expiresAt: string; nonce: string; payload: Payloads[T]; auth: Auth;
} }[MessageType];

// Populated by MM-204 message signing. Empty for unsigned M1 messages; mac is an HMAC-SHA256 hex digest.
export type Auth = { mac?: string; keyId?: string };

export class ProtocolError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

function isTimestamp(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, offset] = parts;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === `${year}-${month}-${day}`
    && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60
    && (offset === 'Z' || (Number(offset?.slice(1, 3)) < 24 && Number(offset?.slice(4)) < 60))
    && Number.isFinite(Date.parse(value));
}

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addFormat('date-time', isTimestamp);
const validateSchema = ajv.compile(schema);

export function validateMessage(value: unknown): Message {
  if (typeof value === 'object' && value !== null && 'protocolVersion' in value && value.protocolVersion !== '1') {
    throw new ProtocolError('UNSUPPORTED_VERSION', 'Only protocol version 1 is supported');
  }
  if (!validateSchema(value)) {
    throw new ProtocolError('INVALID_MESSAGE', ajv.errorsText(validateSchema.errors));
  }
  const message = value as Message;
  const ranges: Slot[] = [{ start: message.createdAt, end: message.expiresAt }];
  const payload = message.payload;
  if ('window' in payload) ranges.push(payload.window);
  if ('slot' in payload) ranges.push(payload.slot);
  if ('slots' in payload) ranges.push(...payload.slots);
  if (ranges.some(({ start, end }) => Date.parse(end) <= Date.parse(start))) {
    throw new ProtocolError('INVALID_TIME_RANGE', 'End must be later than start');
  }
  return message;
}

export function parseMessage(raw: string): Message {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new ProtocolError('INVALID_JSON', 'Frame is not valid JSON'); }
  return validateMessage(value);
}

export function createMessage<T extends MessageType>(input: {
  fromAgentId: string; toAgentId: string; meetingId: string;
  type: T; payload: Payloads[T]; sequence: number;
}): Message {
  const now = Date.now();
  return validateMessage({
    ...input, protocolVersion: '1', messageId: randomUUID(), nonce: randomUUID(),
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 180_000).toISOString(), auth: {},
  });
}

// Stable key order makes duplicate comparison independent of a JSON serializer's object order.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
