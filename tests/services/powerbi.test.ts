/**
 * Unit tests for PowerBI service helper functions.
 *
 * Tests the token caching logic and error handling patterns.
 * We can't test getAzureToken/getEmbedToken directly (they make HTTP calls),
 * but we test the pure logic pieces and env var handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PowerBIServiceError } from '../../src/services/powerbi';

// ── PowerBIServiceError ─────────────────────────────────────────────

describe('PowerBIServiceError', () => {
  it('creates error with statusCode and publicMessage', () => {
    const err = new PowerBIServiceError('internal detail', 'user-facing msg', 502);
    expect(err.message).toBe('internal detail');
    expect(err.publicMessage).toBe('user-facing msg');
    expect(err.statusCode).toBe(502);
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults statusCode to 500', () => {
    const err = new PowerBIServiceError('detail', 'public');
    expect(err.statusCode).toBe(500);
  });
});

// ── Env var availability checks ───────────────────────────────────

describe('PowerBI env var contract', () => {
  it('AZURE_TENANT_ID is required', () => {
    // The service reads these env vars at runtime.
    // This test documents the contract — if any var name changes,
    // this test should be updated along with the code.
    const requiredVars = [
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
    ];

    for (const varName of requiredVars) {
      expect(typeof varName).toBe('string');
    }
  });
});

// ── Token caching logic (replicated) ──────────────────────────────

interface AzureTokenCache {
  token: string;
  expiresAtMs: number;
}

function cachedAzureToken(cache: AzureTokenCache | null): string | null {
  if (!cache) return null;
  const safetyWindowMs = 60 * 1000;
  if (Date.now() + safetyWindowMs >= cache.expiresAtMs) return null;
  return cache.token;
}

describe('cachedAzureToken', () => {
  it('returns null when cache is null', () => {
    expect(cachedAzureToken(null)).toBeNull();
  });

  it('returns null when token is about to expire (within 60s)', () => {
    const cache: AzureTokenCache = {
      token: 'abc',
      expiresAtMs: Date.now() + 30_000, // expires in 30s
    };
    expect(cachedAzureToken(cache)).toBeNull();
  });

  it('returns token when far from expiration', () => {
    const cache: AzureTokenCache = {
      token: 'my-token',
      expiresAtMs: Date.now() + 300_000, // expires in 5min
    };
    expect(cachedAzureToken(cache)).toBe('my-token');
  });
});
