import { createHash } from 'crypto';

/**
 * Creates a deterministic canonical JSON string by sorting object keys alphabetically.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();

  const pairs = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`,
  );

  return `{${pairs.join(',')}}`;
}

/**
 * Calculates SHA-256 hash of the canonical JSON representation of business fields.
 */
export function computeCanonicalPayloadHash(payload: Record<string, unknown>): string {
  const canonical = canonicalizeJson(payload);
  return createHash('sha256').update(canonical).digest('hex');
}
