export class CloudError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = 'CloudError';
  }
}

export interface Device {
  id: string;
  siteId: string;
  name: string;
  productId: number;
  online: boolean;
  on: boolean | null;
  firmware?: string;
}

export interface Session {
  appToken: string;
  appExpiresAt: number;
  userToken: string;
  userId: string;
  userExpiresAt: number;
}

export interface Bootstrap { username: string; password: string }

export function expiry(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalidResponse();
  return value;
}

export function parseSession(value: unknown): Session {
  const row = object(value);
  return {
    appToken: nonempty(row.appToken), appExpiresAt: expiry(row.appExpiresAt),
    userToken: nonempty(row.userToken), userId: nonempty(row.userId), userExpiresAt: expiry(row.userExpiresAt),
  };
}

export function jwtExpiry(token: string): number {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1] || parts[1].length > 16_384) return invalidResponse();
    return expiry(object(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))).exp);
  } catch { return invalidResponse(); }
}

export function invalidResponse(): never {
  throw new CloudError('RESPONSE', 'The cloud returned an unexpected response.');
}

export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalidResponse();
  return value as Record<string, unknown>;
}

export function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) return invalidResponse();
  return value;
}

export function identifier(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return nonempty(value);
}

export function arrayField(value: unknown, field: string): unknown[] {
  const result = object(value)[field];
  if (!Array.isArray(result)) return invalidResponse();
  return result;
}

export function parseDevice(value: unknown): Device {
  const row = object(value);
  if (typeof row.is_online !== 'boolean' || !Number.isSafeInteger(row.product_id)) return invalidResponse();
  if (row.switch_1 != null && typeof row.switch_1 !== 'boolean') return invalidResponse();
  return {
    id: nonempty(row.id), siteId: nonempty(row.site_id), name: nonempty(row.name),
    productId: row.product_id as number, online: row.is_online,
    on: (row.switch_1 as boolean | null | undefined) ?? null,
    firmware: typeof row.firmware === 'string' ? row.firmware : undefined,
  };
}

export const supported = (device: Device): boolean => device.productId === 6 || device.productId === 7;
