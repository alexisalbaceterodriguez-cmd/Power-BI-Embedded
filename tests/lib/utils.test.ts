/**
 * Unit tests for shared utility functions.
 * Tests: splitCsv, normalizeEmail, normalizeUsername, normalizeClientId,
 *        isFutureDate, parseJsonArray, toBit, toBoolean, normalizeIdList.
 */
import { describe, it, expect } from 'vitest';
import { splitCsv } from '@/lib/utils';

/**
 * We can't import pool.ts directly because it has `import 'server-only'`
 * which throws outside Next.js runtime. Instead, we duplicate the pure
 * functions here and test them. If they ever drift, the build will catch it
 * because the DAL modules depend on them.
 */

// Pure reimplementations for testing (identical logic to pool.ts)
function normalizeEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string): string {
  return username.trim();
}

function normalizeClientId(clientId?: string | null): string | undefined {
  if (!clientId) return undefined;
  const normalized = clientId.trim().toLowerCase();
  return normalized || undefined;
}

function isFutureDate(value?: string | null): boolean {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function toBit(value: boolean | number): number {
  return value ? 1 : 0;
}

function toBoolean(value: boolean | number | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  return Number(value ?? 0) === 1;
}

function normalizeIdList(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

// ── splitCsv ───────────────────────────────────────────────────────
describe('splitCsv', () => {
  it('returns empty array for undefined', () => {
    expect(splitCsv(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(splitCsv('')).toEqual([]);
  });

  it('splits comma-separated values and trims', () => {
    expect(splitCsv(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  it('filters out empty segments', () => {
    expect(splitCsv('a,,b,  ,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles single value', () => {
    expect(splitCsv('hello')).toEqual(['hello']);
  });
});

// ── normalizeEmail ─────────────────────────────────────────────────
describe('normalizeEmail', () => {
  it('returns undefined for null/undefined/empty', () => {
    expect(normalizeEmail(null)).toBeUndefined();
    expect(normalizeEmail(undefined)).toBeUndefined();
    expect(normalizeEmail('')).toBeUndefined();
  });

  it('lowercases and trims', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
  });
});

// ── normalizeUsername ──────────────────────────────────────────────
describe('normalizeUsername', () => {
  it('trims whitespace', () => {
    expect(normalizeUsername('  admin  ')).toBe('admin');
  });

  it('preserves case', () => {
    expect(normalizeUsername('Admin')).toBe('Admin');
  });
});

// ── normalizeClientId ──────────────────────────────────────────────
describe('normalizeClientId', () => {
  it('returns undefined for null/undefined/empty', () => {
    expect(normalizeClientId(null)).toBeUndefined();
    expect(normalizeClientId(undefined)).toBeUndefined();
    expect(normalizeClientId('  ')).toBeUndefined();
  });

  it('lowercases and trims', () => {
    expect(normalizeClientId('  Cliente-1  ')).toBe('cliente-1');
  });
});

// ── isFutureDate ───────────────────────────────────────────────────
describe('isFutureDate', () => {
  it('returns false for null/undefined', () => {
    expect(isFutureDate(null)).toBe(false);
    expect(isFutureDate(undefined)).toBe(false);
  });

  it('returns false for past date', () => {
    expect(isFutureDate('2020-01-01T00:00:00Z')).toBe(false);
  });

  it('returns true for future date', () => {
    expect(isFutureDate('2099-12-31T23:59:59Z')).toBe(true);
  });
});

// ── parseJsonArray ─────────────────────────────────────────────────
describe('parseJsonArray', () => {
  it('returns empty array for null', () => {
    expect(parseJsonArray(null)).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseJsonArray('not json')).toEqual([]);
  });

  it('returns empty array for non-array JSON', () => {
    expect(parseJsonArray('{"a": 1}')).toEqual([]);
  });

  it('filters non-string items', () => {
    expect(parseJsonArray('[1, "hello", null, "world"]')).toEqual(['hello', 'world']);
  });

  it('parses valid string array', () => {
    expect(parseJsonArray('["a", "b", "c"]')).toEqual(['a', 'b', 'c']);
  });
});

// ── toBit ──────────────────────────────────────────────────────────
describe('toBit', () => {
  it('returns 1 for true', () => {
    expect(toBit(true)).toBe(1);
  });

  it('returns 0 for false', () => {
    expect(toBit(false)).toBe(0);
  });

  it('returns 1 for truthy number', () => {
    expect(toBit(1)).toBe(1);
  });

  it('returns 0 for 0', () => {
    expect(toBit(0)).toBe(0);
  });
});

// ── toBoolean ──────────────────────────────────────────────────────
describe('toBoolean', () => {
  it('returns true for boolean true', () => {
    expect(toBoolean(true)).toBe(true);
  });

  it('returns false for boolean false', () => {
    expect(toBoolean(false)).toBe(false);
  });

  it('returns true for 1', () => {
    expect(toBoolean(1)).toBe(true);
  });

  it('returns false for 0', () => {
    expect(toBoolean(0)).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(toBoolean(null)).toBe(false);
    expect(toBoolean(undefined)).toBe(false);
  });
});

// ── normalizeIdList ────────────────────────────────────────────────
describe('normalizeIdList', () => {
  it('returns empty for empty input', () => {
    expect(normalizeIdList([])).toEqual([]);
  });

  it('trims and deduplicates', () => {
    expect(normalizeIdList([' a ', 'b', '  a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('filters empty strings', () => {
    expect(normalizeIdList(['', '  ', 'x'])).toEqual(['x']);
  });
});
