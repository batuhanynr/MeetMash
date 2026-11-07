import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Secrets and session tokens are stored as scrypt hashes, never in clear text. Format: salt:derived (both hex).
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(secret, salt, 32).toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [saltHex, expectedHex] = stored.split(':');
  if (!saltHex || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(secret, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const randomToken = (): string => randomBytes(32).toString('hex');
