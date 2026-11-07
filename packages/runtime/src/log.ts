import type { Message } from '../../protocol/src/index.ts';

export type LogFields = Record<string, unknown>;
export type Logger = (event: string, fields?: LogFields) => void;

export function jsonLogger(runId: string, agentId: string): Logger {
  return (event, fields = {}) => console.log(JSON.stringify({
    timestamp: new Date().toISOString(), runId, agentId, meetingId: null, messageId: null,
    messageType: null, direction: null, event, attempt: null, outcome: null, ...fields,
  }));
}

export function messageFields(message: Message): LogFields {
  return { meetingId: message.meetingId, messageId: message.messageId, messageType: message.type };
}
