import { parseArgs } from 'node:util';

export function options(names: string[]): Record<string, string | undefined> {
  const { values } = parseArgs({ options: Object.fromEntries(names.map(name => [name, { type: 'string' }])) });
  return values as Record<string, string | undefined>;
}

export function integer(value: string, name: string, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}

export function requireLoopbackUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('M1 requires a loopback ws:// hub URL');
  }
  return url;
}
